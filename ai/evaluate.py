from __future__ import annotations

import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from dataset import MathHandwritingDataset
from model import HandwritingCleaner


@torch.inference_mode()
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(r"C:\Users\dongh\Downloads\110.수학 과목 자동 풀이 데이터"),
    )
    parser.add_argument("--checkpoint", type=Path, default=Path("ai/runs/best.pt"))
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = HandwritingCleaner(checkpoint.get("base_channels", 32))
    model.load_state_dict(checkpoint["model"])
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()

    dataset = MathHandwritingDataset(
        args.data,
        "Validation",
        checkpoint.get("image_size", 512),
        samples_per_epoch=args.samples,
    )
    loader = DataLoader(
        dataset,
        batch_size=1,
        num_workers=args.workers,
        pin_memory=device.type == "cuda",
    )
    thresholds = torch.arange(0.2, 0.81, 0.025, device=device)
    intersections = torch.zeros_like(thresholds)
    predictions = torch.zeros_like(thresholds)
    expected = torch.zeros_like(thresholds)

    for inputs, target in loader:
        probability = model(inputs.to(device))[:, 1:2].sigmoid()
        truth = target[:, 1:2].to(device) >= 0.5
        for index, threshold in enumerate(thresholds):
            prediction = probability >= threshold
            intersections[index] += (prediction & truth).sum()
            predictions[index] += prediction.sum()
            expected[index] += truth.sum()

    precision = intersections / predictions.clamp_min(1)
    recall = intersections / expected.clamp_min(1)
    f1 = 2 * precision * recall / (precision + recall).clamp_min(1e-8)
    best = int(f1.argmax())
    print(
        f"threshold={thresholds[best].item():.3f} "
        f"precision={precision[best].item():.4f} "
        f"recall={recall[best].item():.4f} "
        f"f1={f1[best].item():.4f}",
    )


if __name__ == "__main__":
    main()
