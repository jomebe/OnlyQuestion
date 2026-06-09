from __future__ import annotations

import torch
from torch import nn
from torch.nn import functional as F


class ResidualBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        groups = min(8, out_channels)
        self.body = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.GroupNorm(groups, out_channels),
            nn.SiLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.GroupNorm(groups, out_channels),
        )
        self.skip = (
            nn.Identity()
            if in_channels == out_channels
            else nn.Conv2d(in_channels, out_channels, 1, bias=False)
        )
        self.activation = nn.SiLU(inplace=True)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.activation(self.body(inputs) + self.skip(inputs))


class DownBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.down = nn.Conv2d(in_channels, out_channels, 3, stride=2, padding=1)
        self.block = ResidualBlock(out_channels, out_channels)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.block(self.down(inputs))


class UpBlock(nn.Module):
    def __init__(
        self,
        in_channels: int,
        skip_channels: int,
        out_channels: int,
    ) -> None:
        super().__init__()
        self.project = nn.Conv2d(in_channels, out_channels, 1)
        self.block = ResidualBlock(out_channels + skip_channels, out_channels)

    def forward(
        self,
        inputs: torch.Tensor,
        skip: torch.Tensor,
    ) -> torch.Tensor:
        inputs = F.interpolate(
            inputs,
            size=skip.shape[-2:],
            mode="bilinear",
            align_corners=False,
        )
        return self.block(torch.cat((self.project(inputs), skip), dim=1))


class HandwritingCleaner(nn.Module):
    """Predicts clean luminance and a handwriting mask."""

    def __init__(self, base_channels: int = 32) -> None:
        super().__init__()
        channels = [
            base_channels,
            base_channels * 2,
            base_channels * 4,
            base_channels * 8,
            base_channels * 12,
        ]
        self.stem = ResidualBlock(3, channels[0])
        self.down1 = DownBlock(channels[0], channels[1])
        self.down2 = DownBlock(channels[1], channels[2])
        self.down3 = DownBlock(channels[2], channels[3])
        self.down4 = DownBlock(channels[3], channels[4])
        self.bottleneck = nn.Sequential(
            ResidualBlock(channels[4], channels[4]),
            ResidualBlock(channels[4], channels[4]),
        )
        self.up3 = UpBlock(channels[4], channels[3], channels[3])
        self.up2 = UpBlock(channels[3], channels[2], channels[2])
        self.up1 = UpBlock(channels[2], channels[1], channels[1])
        self.up0 = UpBlock(channels[1], channels[0], channels[0])
        self.head = nn.Conv2d(channels[0], 2, 1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        skip0 = self.stem(inputs)
        skip1 = self.down1(skip0)
        skip2 = self.down2(skip1)
        skip3 = self.down3(skip2)
        encoded = self.bottleneck(self.down4(skip3))
        decoded = self.up3(encoded, skip3)
        decoded = self.up2(decoded, skip2)
        decoded = self.up1(decoded, skip1)
        decoded = self.up0(decoded, skip0)
        return self.head(decoded)

