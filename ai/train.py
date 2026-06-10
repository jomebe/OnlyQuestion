from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader

from dataset import MathHandwritingDataset
from model import HandwritingCleaner


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(r"C:\Users\dongh\Downloads\110.수학 과목 자동 풀이 데이터"),
    )
    parser.add_argument("--output", type=Path, default=Path("ai/runs/best.pt"))
    parser.add_argument("--image-size", type=int, default=512)
    parser.add_argument("--steps", type=int, default=30_000)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--accumulation", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--base-channels", type=int, default=32)
    parser.add_argument("--validation-samples", type=int, default=256)
    parser.add_argument("--validate-every", type=int, default=1_000)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--weights", type=Path)
    parser.add_argument(
        "--hard-negative",
        type=Path,
        action="append",
        default=[],
    )
    return parser.parse_args()


def dice_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    prediction = logits.sigmoid()
    numerator = 2 * (prediction * target).sum(dim=(2, 3)) + 1
    denominator = prediction.sum(dim=(2, 3)) + target.sum(dim=(2, 3)) + 1
    return 1 - (numerator / denominator).mean()


def gradient_loss(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    prediction_dx = prediction[:, :, :, 1:] - prediction[:, :, :, :-1]
    target_dx = target[:, :, :, 1:] - target[:, :, :, :-1]
    prediction_dy = prediction[:, :, 1:, :] - prediction[:, :, :-1, :]
    target_dy = target[:, :, 1:, :] - target[:, :, :-1, :]
    return F.l1_loss(prediction_dx, target_dx) + F.l1_loss(
        prediction_dy,
        target_dy,
    )


def compute_loss(
    output: torch.Tensor,
    target: torch.Tensor,
) -> tuple[torch.Tensor, dict[str, float]]:
    clean_target = target[:, :1]
    mask_target = target[:, 1:2]
    clean_prediction = output[:, :1].sigmoid()
    mask_logits = output[:, 1:2]

    mask_bce = F.binary_cross_entropy_with_logits(
        mask_logits,
        mask_target,
        pos_weight=torch.tensor(2.0, device=output.device),
    )
    mask_dice = dice_loss(mask_logits, mask_target)
    false_positive = (
        mask_logits.sigmoid() * (1 - mask_target)
    ).mean()
    pixel_weight = 1 + mask_target * 5
    clean_l1 = ((clean_prediction - clean_target).abs() * pixel_weight).mean()
    edges = gradient_loss(clean_prediction, clean_target)
    loss = (
        mask_bce
        + mask_dice
        + false_positive * 4
        + clean_l1 * 2.5
        + edges * 0.75
    )
    return loss, {
        "mask_bce": mask_bce.item(),
        "mask_dice": mask_dice.item(),
        "false_positive": false_positive.item(),
        "clean_l1": clean_l1.item(),
        "edges": edges.item(),
    }


@torch.inference_mode()
def validate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
) -> dict[str, float]:
    model.eval()
    intersection = 0.0
    predicted = 0.0
    expected = 0.0
    clean_error = 0.0
    batches = 0

    for inputs, target in loader:
        inputs = inputs.to(device, non_blocking=True)
        target = target.to(device, non_blocking=True)
        output = model(inputs)
        mask = output[:, 1:2].sigmoid() >= 0.5
        truth = target[:, 1:2] >= 0.5
        intersection += (mask & truth).sum().item()
        predicted += mask.sum().item()
        expected += truth.sum().item()
        clean = output[:, :1].sigmoid()
        clean_error += ((clean - target[:, :1]).abs() * (1 + truth * 4)).mean().item()
        batches += 1

    precision = intersection / max(1, predicted)
    recall = intersection / max(1, expected)
    f1 = 2 * precision * recall / max(1e-8, precision + recall)
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "clean_error": clean_error / max(1, batches),
    }


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch.set_float32_matmul_precision("high")
    print(f"device={device} torch={torch.__version__}")

    train_dataset = MathHandwritingDataset(
        args.data,
        "Training",
        args.image_size,
        samples_per_epoch=args.steps * args.batch_size,
        hard_negative_paths=args.hard_negative,
    )
    validation_dataset = MathHandwritingDataset(
        args.data,
        "Validation",
        args.image_size,
        samples_per_epoch=args.validation_samples,
    )
    print(
        f"pairs train={len(train_dataset.records)} "
        f"validation={len(validation_dataset.records)}",
    )
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
        persistent_workers=args.workers > 0,
    )
    validation_loader = DataLoader(
        validation_dataset,
        batch_size=1,
        shuffle=False,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
        persistent_workers=args.workers > 0,
    )

    model = HandwritingCleaner(args.base_channels).to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=args.learning_rate,
        weight_decay=1e-4,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer,
        T_max=math.ceil(args.steps / args.accumulation),
        eta_min=args.learning_rate * 0.05,
    )
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    start_step = 0
    best_f1 = 0.0

    if args.weights:
        checkpoint = torch.load(args.weights, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model"])
        source_f1 = checkpoint.get("best_f1", 0.0)
        print(f"loaded weights source_f1={source_f1:.4f}")
    elif args.resume:
        checkpoint = torch.load(args.resume, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        scheduler.load_state_dict(checkpoint["scheduler"])
        scaler.load_state_dict(checkpoint["scaler"])
        start_step = checkpoint["step"]
        best_f1 = checkpoint.get("best_f1", 0.0)
        print(f"resumed step={start_step} best_f1={best_f1:.4f}")

    optimizer.zero_grad(set_to_none=True)
    model.train()
    started_at = time.time()
    latest_path = args.output.with_name(
        f"{args.output.stem}-latest{args.output.suffix}",
    )

    for step, (inputs, target) in enumerate(train_loader, start=start_step + 1):
        if step > args.steps:
            break
        inputs = inputs.to(device, non_blocking=True)
        target = target.to(device, non_blocking=True)
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            output = model(inputs)
            loss, parts = compute_loss(output, target)
            scaled_loss = loss / args.accumulation
        scaler.scale(scaled_loss).backward()

        if step % args.accumulation == 0:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            scheduler.step()

        if step % 25 == 0:
            elapsed = time.time() - started_at
            rate = step / max(1, elapsed)
            eta = (args.steps - step) / max(1e-8, rate)
            print(
                f"step={step}/{args.steps} loss={loss.item():.4f} "
                f"mask={parts['mask_bce'] + parts['mask_dice']:.4f} "
                f"clean={parts['clean_l1']:.4f} "
                f"lr={scheduler.get_last_lr()[0]:.2e} "
                f"eta_min={math.ceil(eta / 60)}",
                flush=True,
            )

        if step % args.validate_every != 0 and step != args.steps:
            continue

        metrics = validate(model, validation_loader, device)
        print(f"validation step={step} {json.dumps(metrics)}", flush=True)
        checkpoint = {
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "scaler": scaler.state_dict(),
            "step": step,
            "best_f1": max(best_f1, metrics["f1"]),
            "base_channels": args.base_channels,
            "image_size": args.image_size,
            "metrics": metrics,
        }
        torch.save(checkpoint, latest_path)
        if metrics["f1"] >= best_f1:
            best_f1 = metrics["f1"]
            torch.save(checkpoint, args.output)
            print(f"saved best checkpoint f1={best_f1:.4f}", flush=True)
        model.train()


if __name__ == "__main__":
    main()
