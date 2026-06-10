from __future__ import annotations

import io
import random
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from torch.utils.data import Dataset


EXPLANATION_STEM = re.compile(r"^(?P<question>.+)_\d+_[OX]$")


@dataclass(frozen=True)
class PairRecord:
    question_zip: Path
    question_entry: str
    explanation_zip: Path
    explanation_entry: str


def build_index(dataset_root: Path, split: str) -> list[PairRecord]:
    source_root = dataset_root / "3.개방데이터" / "1.데이터" / split / "01.원천데이터"
    question_zips = sorted(source_root.glob("*_1.문제_*.zip"))
    records: list[PairRecord] = []

    for question_zip in question_zips:
        explanation_zip = question_zip.with_name(
            question_zip.name.replace("_1.문제_", "_3.손글씨풀이_"),
        )
        if not explanation_zip.exists():
            continue

        with zipfile.ZipFile(question_zip) as archive:
            questions = {
                Path(name).stem: name
                for name in archive.namelist()
                if Path(name).suffix.lower() in {".png", ".jpg", ".jpeg"}
            }

        with zipfile.ZipFile(explanation_zip) as archive:
            for name in archive.namelist():
                if Path(name).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
                    continue
                match = EXPLANATION_STEM.match(Path(name).stem)
                if not match:
                    continue
                question_entry = questions.get(match.group("question"))
                if question_entry:
                    records.append(
                        PairRecord(
                            question_zip,
                            question_entry,
                            explanation_zip,
                            name,
                        ),
                    )

    if not records:
        raise RuntimeError(f"No matching image pairs found under {source_root}")
    return records


class MathHandwritingDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(
        self,
        dataset_root: Path,
        split: str,
        image_size: int = 512,
        samples_per_epoch: int | None = None,
        seed: int = 20260609,
        hard_negative_paths: list[Path] | None = None,
    ) -> None:
        self.records = build_index(dataset_root, split)
        self.image_size = image_size
        self.samples_per_epoch = samples_per_epoch or len(self.records)
        self.seed = seed
        self.training = split.lower() == "training"
        self.hard_negative_paths = hard_negative_paths or []
        self._archives: dict[Path, zipfile.ZipFile] = {}
        self._hard_negatives: dict[Path, Image.Image] = {}

    def __len__(self) -> int:
        return self.samples_per_epoch

    def __getstate__(self) -> dict:
        state = self.__dict__.copy()
        state["_archives"] = {}
        return state

    def __del__(self) -> None:
        for archive in getattr(self, "_archives", {}).values():
            archive.close()

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        if self.training:
            random_index = random.randrange(len(self.records))
            rng = random.Random()
        else:
            random_index = index % len(self.records)
            rng = random.Random(self.seed + index)

        if (
            self.training
            and self.hard_negative_paths
            and rng.random() < 0.65
        ):
            path = rng.choice(self.hard_negative_paths)
            composite = self._hard_negative(path, rng)
            clean = composite.copy()
            handwriting_mask = np.zeros(
                (self.image_size, self.image_size),
                dtype=np.float32,
            )
        else:
            record = self.records[random_index]
            question_count = rng.randint(2, 5) if self.training else 4
            questions = [
                self._read_image(record.question_zip, record.question_entry),
            ]
            for _ in range(question_count - 1):
                extra_record = self.records[rng.randrange(len(self.records))]
                questions.append(
                    self._read_image(
                        extra_record.question_zip,
                        extra_record.question_entry,
                    ),
                )
            explanation = self._read_image(
                record.explanation_zip,
                record.explanation_entry,
            )
            composite, clean, handwriting_mask = self._compose(
                questions,
                explanation,
                rng,
            )

        input_tensor = torch.from_numpy(composite.transpose(2, 0, 1)).float() / 255
        clean_luminance = cv2.cvtColor(clean, cv2.COLOR_RGB2GRAY)
        target = np.stack((clean_luminance / 255, handwriting_mask), axis=0)
        return input_tensor, torch.from_numpy(target).float()

    def _archive(self, path: Path) -> zipfile.ZipFile:
        archive = self._archives.get(path)
        if archive is None:
            archive = zipfile.ZipFile(path)
            self._archives[path] = archive
        return archive

    def _read_image(self, archive_path: Path, entry: str) -> Image.Image:
        data = self._archive(archive_path).read(entry)
        with Image.open(io.BytesIO(data)) as image:
            return image.convert("RGB")

    def _hard_negative(
        self,
        path: Path,
        rng: random.Random,
    ) -> np.ndarray:
        image = self._hard_negatives.get(path)
        if image is None:
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
            self._hard_negatives[path] = image

        minimum_scale = max(
            self.image_size / image.width,
            self.image_size / image.height,
        )
        scale = rng.uniform(minimum_scale, minimum_scale * 1.25)
        resized = image.resize(
            (
                round(image.width * scale),
                round(image.height * scale),
            ),
            Image.Resampling.LANCZOS,
        )
        x = rng.randint(0, resized.width - self.image_size)
        y = rng.randint(0, resized.height - self.image_size)
        crop = resized.crop(
            (x, y, x + self.image_size, y + self.image_size),
        )
        crop = ImageEnhance.Contrast(crop).enhance(rng.uniform(0.9, 1.1))
        crop = ImageEnhance.Brightness(crop).enhance(rng.uniform(0.94, 1.06))
        return np.asarray(crop).copy()

    def _compose(
        self,
        questions: list[Image.Image],
        explanation: Image.Image,
        rng: random.Random,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        size = self.image_size
        paper_color = rng.randint(242, 255)
        clean = Image.new("RGB", (size, size), (paper_color,) * 3)
        question_bounds: list[tuple[int, int, int, int]] = []
        slot_height = size / len(questions)

        for index, question in enumerate(questions):
            question_scale = rng.uniform(0.76, 1.08) * size / question.width
            question_height = max(1, round(question.height * question_scale))
            question_width = max(1, round(question.width * question_scale))
            max_height = max(36, round(slot_height * 0.62))
            if question_height > max_height:
                resize_scale = max_height / question_height
                question_height = max_height
                question_width = max(1, round(question_width * resize_scale))
            question = question.resize(
                (question_width, question_height),
                Image.Resampling.LANCZOS,
            )
            question = ImageEnhance.Contrast(question).enhance(
                rng.uniform(0.68, 1.22),
            )
            question = ImageEnhance.Brightness(question).enhance(
                rng.uniform(0.88, 1.08),
            )
            if rng.random() < 0.45:
                question = question.filter(
                    ImageFilter.GaussianBlur(rng.uniform(0.1, 0.75)),
                )

            question_x = rng.randint(4, max(4, size - question_width - 4))
            slot_top = round(index * slot_height)
            slot_bottom = round((index + 1) * slot_height)
            question_y = rng.randint(
                min(slot_top + 4, size - question_height),
                max(
                    min(slot_top + 4, size - question_height),
                    min(slot_bottom - question_height - 4, size - question_height),
                ),
            )
            clean.paste(question, (question_x, question_y))
            question_bounds.append(
                (question_x, question_y, question_width, question_height),
            )

        clean_array = np.asarray(clean).copy()
        composite = clean_array.copy()
        target_mask = np.zeros((size, size), dtype=np.float32)

        if rng.random() >= 0.30:
            ink_mask = self._extract_ink(explanation)
            scale = rng.uniform(0.22, 0.88) * size / explanation.width
            width = max(32, round(explanation.width * scale))
            height = max(32, round(explanation.height * scale))
            ink_mask_image = Image.fromarray(np.uint8(ink_mask * 255)).resize(
                (width, height),
                Image.Resampling.LANCZOS,
            )
            angle = rng.uniform(-5, 5)
            ink_mask_image = ink_mask_image.rotate(
                angle,
                Image.Resampling.BICUBIC,
                expand=True,
            )
            transformed_mask = np.asarray(ink_mask_image, dtype=np.float32) / 255
            transformed_mask = np.clip((transformed_mask - 0.05) / 0.75, 0, 1)

            if rng.random() < 0.58:
                _, question_y, _, question_height = rng.choice(question_bounds)
                y_min = max(
                    -transformed_mask.shape[0] // 4,
                    question_y - transformed_mask.shape[0] // 3,
                )
                y_max = min(
                    size - 1,
                    question_y + question_height - transformed_mask.shape[0] // 4,
                )
                y = rng.randint(min(y_min, y_max), max(y_min, y_max))
            else:
                y = rng.randint(
                    min(0, size - transformed_mask.shape[0]),
                    max(0, size - transformed_mask.shape[0]),
                )
            x = rng.randint(
                -transformed_mask.shape[1] // 4,
                max(-transformed_mask.shape[1] // 4, size - transformed_mask.shape[1]),
            )
            self._blend_ink(composite, target_mask, transformed_mask, x, y, rng)

        composite = self._photograph_augmentation(composite, rng)
        return composite, clean_array, target_mask

    @staticmethod
    def _extract_ink(image: Image.Image) -> np.ndarray:
        array = np.asarray(image, dtype=np.float32)
        darkness = (255 - array.min(axis=2)) / 255
        channel_range = (array.max(axis=2) - array.min(axis=2)) / 255
        mask = np.maximum(darkness, channel_range * 1.4)
        mask = np.clip((mask - 0.035) / 0.42, 0, 1)
        return cv2.GaussianBlur(mask, (3, 3), 0)

    @staticmethod
    def _blend_ink(
        composite: np.ndarray,
        target_mask: np.ndarray,
        ink_mask: np.ndarray,
        x: int,
        y: int,
        rng: random.Random,
    ) -> None:
        height, width = ink_mask.shape
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(composite.shape[1], x + width)
        y1 = min(composite.shape[0], y + height)
        if x0 >= x1 or y0 >= y1:
            return

        mask = ink_mask[y0 - y : y1 - y, x0 - x : x1 - x]
        colors = [
            (8, 45, 185),
            (12, 12, 18),
            (175, 20, 28),
            (30, 90, 45),
            (85, 80, 75),
            (115, 110, 105),
            (145, 140, 135),
        ]
        color = np.asarray(rng.choice(colors), dtype=np.float32)
        opacity = mask[..., None] * rng.uniform(0.32, 0.96)
        region = composite[y0:y1, x0:x1].astype(np.float32)
        composite[y0:y1, x0:x1] = np.uint8(
            np.clip(region * (1 - opacity) + color * opacity, 0, 255),
        )
        target_mask[y0:y1, x0:x1] = np.maximum(
            target_mask[y0:y1, x0:x1],
            mask,
        )

    @staticmethod
    def _photograph_augmentation(
        image: np.ndarray,
        rng: random.Random,
    ) -> np.ndarray:
        height, width = image.shape[:2]
        result = image.astype(np.float32)

        if rng.random() < 0.8:
            direction = rng.choice(("horizontal", "vertical"))
            if direction == "horizontal":
                gradient = np.linspace(
                    rng.uniform(0.78, 1),
                    rng.uniform(0.9, 1.08),
                    width,
                )[None, :, None]
            else:
                gradient = np.linspace(
                    rng.uniform(0.78, 1),
                    rng.uniform(0.9, 1.08),
                    height,
                )[:, None, None]
            result *= gradient

        tint = np.asarray(
            [
                rng.uniform(0.96, 1.04),
                rng.uniform(0.96, 1.04),
                rng.uniform(0.94, 1.03),
            ],
            dtype=np.float32,
        )
        result *= tint
        noise = np.random.default_rng(rng.randrange(2**32)).normal(
            0,
            rng.uniform(0, 2.2),
            result.shape,
        )
        result = np.uint8(np.clip(result + noise, 0, 255))

        pil_image = Image.fromarray(result)
        if rng.random() < 0.35:
            pil_image = pil_image.filter(
                ImageFilter.GaussianBlur(rng.uniform(0.15, 0.65)),
            )
        if rng.random() < 0.45:
            buffer = io.BytesIO()
            pil_image.save(buffer, format="JPEG", quality=rng.randint(72, 95))
            buffer.seek(0)
            with Image.open(buffer) as jpeg:
                pil_image = jpeg.convert("RGB")
        return np.asarray(pil_image).copy()
