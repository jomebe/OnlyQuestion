from __future__ import annotations

import argparse
from pathlib import Path

import onnx
import torch

from model import HandwritingCleaner


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path("ai/runs/best.pt"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/models/handwriting-cleaner.onnx"),
    )
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = HandwritingCleaner(checkpoint.get("base_channels", 32))
    model.load_state_dict(checkpoint["model"])
    model.eval()
    image_size = checkpoint.get("image_size", 512)
    example = torch.zeros(1, 3, image_size, image_size)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        example,
        args.output,
        input_names=["image"],
        output_names=["prediction"],
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx_model = onnx.load(args.output)
    onnx.checker.check_model(onnx_model)
    size_mb = args.output.stat().st_size / 1024 / 1024
    print(f"exported={args.output} size_mb={size_mb:.1f}")


if __name__ == "__main__":
    main()

