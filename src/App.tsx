import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";

type ImageSettings = {
  background: number;
  contrast: number;
  brightness: number;
  colorRemoval: number;
  grayscale: boolean;
};

type LoadedImage = {
  image: HTMLImageElement;
  width: number;
  height: number;
};

type SliderKey = "background" | "contrast" | "brightness" | "colorRemoval";

const defaultSettings: ImageSettings = {
  background: 64,
  contrast: 52,
  brightness: 6,
  colorRemoval: 70,
  grayscale: false,
};

const autoSettings: ImageSettings = {
  background: 76,
  contrast: 62,
  brightness: 8,
  colorRemoval: 82,
  grayscale: false,
};

const sliders: Array<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  unit: string;
}> = [
  { key: "background", label: "배경 제거", min: 0, max: 100, unit: "%" },
  { key: "contrast", label: "대비", min: 0, max: 100, unit: "%" },
  { key: "brightness", label: "밝기", min: -30, max: 30, unit: "" },
  { key: "colorRemoval", label: "색펜/형광펜 제거", min: 0, max: 100, unit: "%" },
];

const maxCanvasSide = 2200;

export default function App() {
  const [source, setSource] = useState<LoadedImage | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [settings, setSettings] = useState<ImageSettings>(defaultSettings);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const objectUrlRef = useRef("");
  const jobRef = useRef(0);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!source) {
      return;
    }

    const jobId = jobRef.current + 1;
    jobRef.current = jobId;
    setIsProcessing(true);

    const frame = window.requestAnimationFrame(() => {
      try {
        const nextResult = cleanImage(source.image, settings);
        if (jobRef.current === jobId) {
          setResultUrl(nextResult);
          setError("");
        }
      } catch (nextError) {
        if (jobRef.current === jobId) {
          setError("이미지를 처리하는 중 문제가 생겼습니다.");
          setResultUrl("");
        }
      } finally {
        if (jobRef.current === jobId) {
          setIsProcessing(false);
        }
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [source, settings]);

  const loadFile = (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = objectUrl;
      setOriginalUrl(objectUrl);
      setSource({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      setFileName(file.name);
      setError("");
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError("이미지를 불러오지 못했습니다.");
    };

    image.src = objectUrl;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    loadFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    loadFile(event.dataTransfer.files?.[0] ?? null);
  };

  const updateSlider = (key: SliderKey, value: number) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const downloadPng = () => {
    if (!resultUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = buildDownloadName("png");
    link.click();
  };

  const downloadPdf = () => {
    if (!resultUrl) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      const orientation: "portrait" | "landscape" =
        image.width > image.height ? "landscape" : "portrait";
      const pdf = new jsPDF({ orientation, unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      const ratio = Math.min(
        availableWidth / image.width,
        availableHeight / image.height,
      );
      const drawWidth = image.width * ratio;
      const drawHeight = image.height * ratio;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;

      pdf.addImage(resultUrl, "PNG", x, y, drawWidth, drawHeight);
      pdf.save(buildDownloadName("pdf"));
    };
    image.src = resultUrl;
  };

  const buildDownloadName = (extension: "png" | "pdf") => {
    const cleanBase = fileName.replace(/\.[^.]+$/, "").trim() || "result";
    return `문제만-${cleanBase}.${extension}`;
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>문제만</h1>
          <p>{fileName || "사진을 올리면 바로 처리합니다"}</p>
        </div>
        {source && (
          <span className="image-size">
            {source.width} x {source.height}
          </span>
        )}
      </header>

      <main className="workspace">
        <section className="upload-pane" aria-label="이미지 업로드">
          <label
            className="upload-box"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              aria-label="이미지 선택"
            />
            <span>이미지 선택</span>
            <strong>JPG, PNG</strong>
          </label>

          <button
            className="secondary-button"
            type="button"
            onClick={() => setSettings(autoSettings)}
            disabled={!source}
          >
            자동 클린
          </button>

          {error && <p className="error-text">{error}</p>}
        </section>

        <section className="preview-grid" aria-label="이미지 미리보기">
          <PreviewPanel title="원본" imageUrl={originalUrl} />
          <PreviewPanel
            title={isProcessing ? "결과 처리 중" : "결과"}
            imageUrl={resultUrl}
          />
        </section>

        <aside className="control-pane" aria-label="조절 옵션">
          <div className="control-group">
            {sliders.map((slider) => (
              <label className="slider-row" key={slider.key}>
                <span>
                  {slider.label}
                  <b>
                    {settings[slider.key]}
                    {slider.unit}
                  </b>
                </span>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  value={settings[slider.key]}
                  onChange={(event) =>
                    updateSlider(slider.key, Number(event.target.value))
                  }
                  disabled={!source}
                />
              </label>
            ))}

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.grayscale}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    grayscale: event.target.checked,
                  }))
                }
                disabled={!source}
              />
              <span>흑백 변환</span>
            </label>
          </div>

          <div className="download-row">
            <button type="button" onClick={downloadPng} disabled={!resultUrl}>
              PNG 저장
            </button>
            <button type="button" onClick={downloadPdf} disabled={!resultUrl}>
              PDF 저장
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

function PreviewPanel({
  title,
  imageUrl,
}: {
  title: string;
  imageUrl: string;
}) {
  return (
    <article className="preview-panel">
      <div className="preview-title">{title}</div>
      <div className="image-frame">
        {imageUrl ? (
          <img src={imageUrl} alt={`${title} 미리보기`} />
        ) : (
          <span>이미지 없음</span>
        )}
      </div>
    </article>
  );
}

function cleanImage(image: HTMLImageElement, settings: ImageSettings) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    maxCanvasSide / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const gray = new Float32Array(width * height);
  const backgroundStrength = settings.background / 100;
  const colorStrength = settings.colorRemoval / 100;
  const contrastFactor = 0.85 + settings.contrast / 75;

  for (let index = 0, pixelIndex = 0; index < pixels.length; index += 4) {
    let red = pixels[index];
    let green = pixels[index + 1];
    let blue = pixels[index + 2];
    const alpha = pixels[index + 3];

    if (alpha === 0) {
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      gray[pixelIndex] = 255;
      pixelIndex += 1;
      continue;
    }

    const luminance = getLuminance(red, green, blue);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const isHighlighter =
      saturation > 0.14 &&
      luminance > 120 &&
      ((red > 170 && green > 135 && blue < 190) ||
        (red > 170 && blue > 135 && green < 190) ||
        (green > 145 && red < 220 && blue < 220) ||
        (blue > 145 && red < 210));
    const isColorPen =
      saturation > 0.22 &&
      luminance < 195 &&
      (red > min + 34 || green > min + 34 || blue > min + 34);

    if (isHighlighter || isColorPen) {
      const removal = colorStrength * (isHighlighter ? 0.95 : 0.74);
      red = mix(red, 255, removal);
      green = mix(green, 255, removal);
      blue = mix(blue, 255, removal);
    }

    const afterColorLuminance = getLuminance(red, green, blue);
    const backgroundScore =
      smoothstep(115, 245, afterColorLuminance) *
      (saturation < 0.45 ? 1 : 0.68);
    const backgroundRemoval = backgroundStrength * backgroundScore;

    red = mix(red, 255, backgroundRemoval);
    green = mix(green, 255, backgroundRemoval);
    blue = mix(blue, 255, backgroundRemoval);

    const afterBackgroundLuminance = getLuminance(red, green, blue);
    const inkScore = 1 - smoothstep(52, 158, afterBackgroundLuminance);
    const inkBoost = inkScore * (0.16 + settings.contrast / 230);

    red = mix(red, 0, inkBoost);
    green = mix(green, 0, inkBoost);
    blue = mix(blue, 0, inkBoost);

    red = (red - 128) * contrastFactor + 128 + settings.brightness;
    green = (green - 128) * contrastFactor + 128 + settings.brightness;
    blue = (blue - 128) * contrastFactor + 128 + settings.brightness;

    pixels[index] = clamp(red);
    pixels[index + 1] = clamp(green);
    pixels[index + 2] = clamp(blue);
    pixels[index + 3] = 255;
    gray[pixelIndex] = getLuminance(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    );
    pixelIndex += 1;
  }

  if (settings.grayscale) {
    applySimpleAdaptiveThreshold(pixels, gray, width, height, settings);
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function applySimpleAdaptiveThreshold(
  pixels: Uint8ClampedArray,
  gray: Float32Array,
  width: number,
  height: number,
  settings: ImageSettings,
) {
  const stride = width + 1;
  const integral = new Float32Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(width, height) / 80));
  const offset = 10 + (settings.background / 100) * 24 + settings.contrast * 0.08;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + x1 + 1] -
        integral[y0 * stride + x1 + 1] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const localAverage = sum / area;
      const luminance = gray[y * width + x];
      const threshold = localAverage - offset;
      const value =
        luminance < 82
          ? 0
          : clamp(mix(28, 255, smoothstep(-12, 12, luminance - threshold)));
      const pixelIndex = (y * width + x) * 4;

      pixels[pixelIndex] = value;
      pixels[pixelIndex + 1] = value;
      pixels[pixelIndex + 2] = value;
      pixels[pixelIndex + 3] = 255;
    }
  }
}

function getLuminance(red: number, green: number, blue: number) {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * clamp01(amount);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
