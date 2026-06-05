import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";

type ImageSettings = {
  background: number;
  contrast: number;
  brightness: number;
  highlighterRemoval: number;
  colorPenRemoval: number;
  grayscale: boolean;
};

type UsageState = {
  date: string;
  freeUsed: number;
  credits: number;
  unlimited: boolean;
};

type LoadedImage = {
  image: HTMLImageElement;
  width: number;
  height: number;
};

type SliderKey =
  | "background"
  | "contrast"
  | "brightness"
  | "highlighterRemoval"
  | "colorPenRemoval";

type Feedback = {
  createdAt: string;
  fileName: string;
  message: string;
};

const dailyFreeLimit = 3;
const betaFree = true;
const maxCanvasSide = 2200;
const usageKey = "only-question-usage";
const feedbackKey = "only-question-feedback";

const defaultSettings: ImageSettings = {
  background: 64,
  contrast: 52,
  brightness: 6,
  highlighterRemoval: 72,
  colorPenRemoval: 56,
  grayscale: false,
};

const autoSettings: ImageSettings = {
  background: 76,
  contrast: 62,
  brightness: 8,
  highlighterRemoval: 86,
  colorPenRemoval: 72,
  grayscale: false,
};

const sliders: Array<{
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  unit: string;
}> = [
  { key: "background", label: "배경 제거 강도", min: 0, max: 100, unit: "%" },
  { key: "contrast", label: "대비", min: 0, max: 100, unit: "%" },
  { key: "brightness", label: "밝기", min: -30, max: 30, unit: "" },
  {
    key: "highlighterRemoval",
    label: "형광펜 제거 강도",
    min: 0,
    max: 100,
    unit: "%",
  },
  {
    key: "colorPenRemoval",
    label: "색펜 제거 강도",
    min: 0,
    max: 100,
    unit: "%",
  },
];

const plans = [
  {
    name: "무료",
    price: "베타 기간 무료",
    description: "정식 출시 전까지 제한 없이 사용합니다. 사진은 서버에 저장하지 않습니다.",
    action: "무료로 쓰기",
  },
  {
    name: "10장 이용권",
    price: "500원",
    description: "시험지 정리 오래 걸리면 그냥 500원으로 끝내세요.",
    action: "10장 구매",
  },
  {
    name: "월 무제한",
    price: "1,900원",
    description: "시험 기간에 계속 쓰는 학생용.",
    action: "무제한 문의",
  },
  {
    name: "학원/과외쌤용",
    price: "월 9,900원",
    description: "대량 정리, 여러 학생 자료 정리 문의.",
    action: "학원용 문의",
  },
];

export default function App() {
  const [source, setSource] = useState<LoadedImage | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [settings, setSettings] = useState<ImageSettings>(defaultSettings);
  const [usage, setUsage] = useState<UsageState>(() => loadUsage());
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [ticketCode, setTicketCode] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const objectUrlRef = useRef("");
  const jobRef = useRef(0);

  const remainingFree = Math.max(0, dailyFreeLimit - usage.freeUsed);
  const hasUsage =
    betaFree || usage.unlimited || remainingFree > 0 || usage.credits > 0;

  useEffect(() => {
    saveUsage(usage);
  }, [usage]);

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

  const consumeOneUse = () => {
    if (betaFree) {
      setUsage((current) => ({ ...current, freeUsed: current.freeUsed + 1 }));
      return true;
    }

    if (usage.unlimited) {
      return true;
    }

    if (remainingFree > 0) {
      setUsage((current) => ({ ...current, freeUsed: current.freeUsed + 1 }));
      if (remainingFree === 1 && usage.credits === 0) {
        setShowUpgrade(true);
      }
      return true;
    }

    if (usage.credits > 0) {
      setUsage((current) => ({ ...current, credits: current.credits - 1 }));
      return true;
    }

    setShowUpgrade(true);
    setError("오늘 무료 3장을 다 썼습니다. 이용권을 구매하거나 코드를 입력하세요.");
    return false;
  };

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
      if (!consumeOneUse()) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

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
      setFeedbackMessage("");
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

  const applyTicketCode = () => {
    const code = ticketCode.trim().toUpperCase();

    if (code === "CLEAN10") {
      setUsage((current) => ({ ...current, credits: current.credits + 10 }));
      setTicketCode("");
      setTicketMessage("10장 이용권이 추가됐습니다.");
      setShowUpgrade(false);
      return;
    }

    if (code === "PRO1900") {
      setUsage((current) => ({ ...current, unlimited: true }));
      setTicketCode("");
      setTicketMessage("월 무제한 모드가 켜졌습니다.");
      setShowUpgrade(false);
      return;
    }

    setTicketMessage("코드를 다시 확인하세요. 테스트 코드: CLEAN10, PRO1900");
  };

  const submitFeedback = () => {
    const message = feedback.trim();
    if (!message) {
      setFeedbackMessage("어떤 점이 이상했는지 적어주세요.");
      return;
    }

    const nextFeedback: Feedback = {
      createdAt: new Date().toISOString(),
      fileName: fileName || "no-file",
      message,
    };
    const previous = loadFeedback();
    localStorage.setItem(feedbackKey, JSON.stringify([nextFeedback, ...previous]));
    console.log("문제만 feedback", nextFeedback);
    setFeedback("");
    setFeedbackMessage("피드백 저장 완료. 다음 개선에 반영합니다.");
    setShowFeedback(false);
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
          <p>{fileName || "베타 기간 무료. 사진은 서버에 저장하지 않습니다."}</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={() => setShowUpgrade(true)}
        >
          정식 출시 가격
        </button>
      </header>

      <section className="usage-bar" aria-label="사용량">
        <div>
          <strong>
            {betaFree
              ? "베타 기간 무료 사용 중"
              : usage.unlimited
              ? "월 무제한 사용 중"
              : `오늘 무료 3장 중 ${remainingFree}장 남음`}
          </strong>
          <span>
            {betaFree
              ? `정식 출시 전까지 제한 없음 · 사용 기록 ${usage.freeUsed}장`
              : usage.unlimited
              ? "시험 기간에도 계속 사용 가능"
              : `추가 이용권 ${usage.credits}장`}
          </span>
        </div>
        <button type="button" onClick={() => setShowUpgrade(true)}>
          출시 가격 보기
        </button>
      </section>

      {ticketMessage && <p className="notice-text">{ticketMessage}</p>}
      {error && <p className="error-text">{error}</p>}

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
            <span>사진 올리기</span>
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

          <p className="helper-text">
            검은 펜 필기는 일부 남을 수 있음
          </p>
          {!hasUsage && (
            <button
              className="buy-button"
              type="button"
              onClick={() => setShowUpgrade(true)}
            >
              정식 출시 가격
            </button>
          )}
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

          <button
            className="feedback-button"
            type="button"
            onClick={() => setShowFeedback((current) => !current)}
            disabled={!resultUrl}
          >
            결과가 이상해요
          </button>

          {showFeedback && (
            <div className="feedback-box">
              <textarea
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder="예: 형광펜이 덜 지워졌어요"
                rows={4}
              />
              <button type="button" onClick={submitFeedback}>
                피드백 보내기
              </button>
            </div>
          )}
          {feedbackMessage && <p className="notice-text">{feedbackMessage}</p>}
        </aside>
      </main>

      {showUpgrade && (
        <UpgradeModal
          ticketCode={ticketCode}
          onTicketCodeChange={setTicketCode}
          onApplyTicketCode={applyTicketCode}
          onClose={() => setShowUpgrade(false)}
        />
      )}
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

function UpgradeModal({
  ticketCode,
  onTicketCodeChange,
  onApplyTicketCode,
  onClose,
}: {
  ticketCode: string;
  onTicketCodeChange: (value: string) => void;
  onApplyTicketCode: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="pricing-modal">
        <div className="modal-head">
          <div>
            <h2>정식 출시 예정 가격</h2>
            <p>지금은 베타 기간이라 무료입니다. 정식 출시 후 가격만 미리 공개합니다.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>

        <div className="plan-grid">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.name}>
              <strong>{plan.name}</strong>
              <b>{plan.price}</b>
              <p>{plan.description}</p>
              <button
                type="button"
                onClick={() => {
                  if (plan.name === "무료") {
                    onClose();
                    return;
                  }

                  onClose();
                }}
              >
                {plan.action}
              </button>
            </article>
          ))}
        </div>

        <div className="ticket-form">
          <label htmlFor="ticket-code">베타 테스트 코드 입력</label>
          <div>
            <input
              id="ticket-code"
              value={ticketCode}
              onChange={(event) => onTicketCodeChange(event.target.value)}
              placeholder="CLEAN10 또는 PRO1900"
            />
            <button type="button" onClick={onApplyTicketCode}>
              적용
            </button>
          </div>
          <p>베타 중 결제 없음. 테스트: CLEAN10 = 10장 추가, PRO1900 = 무제한</p>
        </div>
      </section>
    </div>
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
  const highlighterStrength = settings.highlighterRemoval / 100;
  const colorPenStrength = settings.colorPenRemoval / 100;
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

    if (isHighlighter) {
      red = mix(red, 255, highlighterStrength * 0.95);
      green = mix(green, 255, highlighterStrength * 0.95);
      blue = mix(blue, 255, highlighterStrength * 0.95);
    } else if (isColorPen) {
      red = mix(red, 255, colorPenStrength * 0.78);
      green = mix(green, 255, colorPenStrength * 0.78);
      blue = mix(blue, 255, colorPenStrength * 0.78);
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

function loadUsage(): UsageState {
  const today = getTodayKey();
  const fallback: UsageState = {
    date: today,
    freeUsed: 0,
    credits: 0,
    unlimited: false,
  };

  try {
    const saved = localStorage.getItem(usageKey);
    if (!saved) {
      return fallback;
    }

    const parsed = JSON.parse(saved) as Partial<UsageState>;
    return {
      date: today,
      freeUsed: parsed.date === today ? Number(parsed.freeUsed) || 0 : 0,
      credits: Math.max(0, Number(parsed.credits) || 0),
      unlimited: Boolean(parsed.unlimited),
    };
  } catch {
    return fallback;
  }
}

function saveUsage(usage: UsageState) {
  localStorage.setItem(usageKey, JSON.stringify(usage));
}

function loadFeedback(): Feedback[] {
  try {
    const saved = localStorage.getItem(feedbackKey);
    return saved ? (JSON.parse(saved) as Feedback[]) : [];
  } catch {
    return [];
  }
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
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
