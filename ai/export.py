from __future__ import annotations

import argparse
import json
import shutil
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
    data_directory = args.output.with_name(f"{args.output.stem}-data")
    temporary_model = data_directory / args.output.name
    manifest_path = args.output.with_name(f"{args.output.stem}.json")
    if data_directory.exists():
        shutil.rmtree(data_directory)
    data_directory.mkdir(parents=True)

    torch.onnx.export(
        model,
        example,
        temporary_model,
        input_names=["image"],
        output_names=["prediction"],
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )
    onnx_model = onnx.load(temporary_model)
    onnx.save_model(
        onnx_model,
        temporary_model,
        save_as_external_data=True,
        all_tensors_to_one_file=False,
        size_threshold=1024,
    )
    onnx.checker.check_model(str(temporary_model))
    onnx_model = onnx.load(temporary_model, load_external_data=False)
    external_files: list[str] = []
    for tensor in onnx_model.graph.initializer:
        for entry in tensor.external_data:
            if entry.key != "location":
                continue
            source_name = entry.value
            target_name = f"weight-{len(external_files):03d}.bin"
            (data_directory / source_name).replace(data_directory / target_name)
            external_files.append(target_name)
            entry.value = f"{data_directory.name}/{target_name}"
    onnx.save_model(onnx_model, args.output)
    temporary_model.unlink()
    onnx.checker.check_model(str(args.output))
    manifest = [
        {
            "path": f"{data_directory.name}/{name}",
            "file": f"{data_directory.name}/{name}",
        }
        for name in external_files
    ]
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    largest_file = max(
        [args.output, manifest_path, *data_directory.iterdir()],
        key=lambda path: path.stat().st_size,
    )
    print(
        f"exported={args.output} external_files={len(external_files)} "
        f"largest={largest_file.name} "
        f"largest_mib={largest_file.stat().st_size / 1024 / 1024:.1f}",
    )


if __name__ == "__main__":
    main()
