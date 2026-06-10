import {
  ChangeEvent,
  DragEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { jsPDF } from "jspdf";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { removeHandwriting } from "./aiCleaner";

type ImageSettings = {
  background: number;
  contrast: number;
  brightness: number;
  highlighterRemoval: number;
  colorPenRemoval: number;
  grayscale: boolean;
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

type InquiryForm = {
  name: string;
  email: string;
  organization: string;
  message: string;
};

type ThemeMode = "light" | "dark";

const maxCanvasSide = 2200;
const feedbackKey = "only-question-feedback";
const formspreeEndpoint = "https://formspree.io/f/xvzngblv";
const themeKey = "only-question-theme";

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

const presets: Array<{
  label: string;
  settings: ImageSettings;
}> = [
  { label: "기본", settings: autoSettings },
  {
    label: "강하게",
    settings: {
      background: 88,
      contrast: 68,
      brightness: 12,
      highlighterRemoval: 92,
      colorPenRemoval: 82,
      grayscale: false,
    },
  },
  {
    label: "글자 선명",
    settings: {
      background: 66,
      contrast: 78,
      brightness: 3,
      highlighterRemoval: 72,
      colorPenRemoval: 58,
      grayscale: true,
    },
  },
];

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

const infoLinks = [
  { href: "about.html", label: "서비스 소개" },
  { href: "guide.html", label: "사용 가이드" },
  { href: "exam-photo-guide.html", label: "시험지 촬영법" },
  { href: "scan-settings-guide.html", label: "보정 설정법" },
  { href: "study-workflow.html", label: "학습 활용법" },
  { href: "highlighter-removal-guide.html", label: "형광펜 지우기" },
  { href: "test-paper-pdf-guide.html", label: "문제지 PDF 만들기" },
  { href: "academy-print-guide.html", label: "학원 프린트 정리" },
  { href: "privacy.html", label: "개인정보 처리방침" },
  { href: "terms.html", label: "이용약관" },
  { href: "contact.html", label: "문의" },
];

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [source, setSource] = useState<LoadedImage | null>(null);
  const [aiSource, setAiSource] = useState<LoadedImage | null>(null);
  const [originalUrl, setOriginalUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [settings, setSettings] = useState<ImageSettings>(defaultSettings);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquiry, setInquiry] = useState<InquiryForm>({
    name: "",
    email: "",
    organization: "",
    message: "",
  });
  const [inquiryStatus, setInquiryStatus] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const objectUrlRef = useRef("");
  const jobRef = useRef(0);
  const aiJobRef = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setAuthError("");
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const processingSource = aiSource ?? source;
    if (!processingSource) {
      return;
    }

    const jobId = jobRef.current + 1;
    jobRef.current = jobId;
    setIsProcessing(true);

    const frame = window.requestAnimationFrame(() => {
      try {
        const nextResult = cleanImage(processingSource.image, settings);
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
  }, [source, aiSource, settings]);

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
      const loadedImage = {
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      setSource(loadedImage);
      setAiSource(null);
      setAiStatus("");
      setFileName(file.name);
      setFeedbackMessage("");
      setError("");
      void runAiCleaner(loadedImage);
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

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setIsDraggingFile(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    loadFile(event.dataTransfer.files?.[0] ?? null);
  };

  const updateSlider = (key: SliderKey, value: number) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const applySettings = (nextSettings: ImageSettings) => {
    setSettings(nextSettings);
  };

  const runAiCleaner = async (inputSource: LoadedImage | null = source) => {
    if (!inputSource) {
      return;
    }

    const aiJobId = aiJobRef.current + 1;
    aiJobRef.current = aiJobId;
    setIsAiProcessing(true);
    setAiStatus("AI 모델을 불러오고 손글씨를 분석하고 있습니다.");
    setError("");
    try {
      const { dataUrl, backend } = await removeHandwriting(
        inputSource.image,
        maxCanvasSide,
      );
      const image = await loadImage(dataUrl);
      if (aiJobRef.current !== aiJobId) {
        return;
      }
      setAiSource({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      setAiStatus(`${backend} AI로 손글씨 제거가 완료되었습니다.`);
    } catch (nextError) {
      if (aiJobRef.current !== aiJobId) {
        return;
      }
      console.error(nextError);
      setAiStatus("");
      setError(
        "AI 모델을 실행하지 못했습니다. WebGPU를 지원하는 최신 Chrome 또는 Edge에서 다시 시도해주세요.",
      );
    } finally {
      if (aiJobRef.current === aiJobId) {
        setIsAiProcessing(false);
      }
    }
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

  const updateInquiry = (key: keyof InquiryForm, value: string) => {
    setInquiry((current) => ({ ...current, [key]: value }));
  };

  const signInWithGoogle = async () => {
    setAuthError("");
    setAuthLoading(true);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString(),
      },
    });

    if (signInError) {
      setAuthError("Google 로그인을 시작하지 못했습니다.");
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    setAuthLoading(true);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setAuthError("로그아웃하지 못했습니다.");
    }
    setAuthLoading(false);
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
        <div className="brand-copy">
          <h1>문제만</h1>
          <strong>문제지 사진 보정기</strong>
          <p>
            {fileName ||
              "시험지, 학원 프린트, 문제지 사진을 깔끔하게 정리해요."}
          </p>
          <div className="trust-chips" aria-label="서비스 특징">
            <span>무료 베타</span>
            <span>브라우저 처리</span>
            <span>PNG/PDF 저장</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
            aria-label="테마 변경"
          >
            {theme === "dark" ? "화이트" : "다크"}
          </button>
          {user ? (
            <div className="account-menu">
              {user.user_metadata.avatar_url && (
                <img
                  src={user.user_metadata.avatar_url}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              )}
              <span>{user.user_metadata.full_name || user.email}</span>
              <button type="button" onClick={signOut} disabled={authLoading}>
                로그아웃
              </button>
            </div>
          ) : (
            <button
              className="google-button"
              type="button"
              onClick={signInWithGoogle}
              disabled={authLoading}
            >
              <span aria-hidden="true">G</span>
              Google 로그인
            </button>
          )}
        </div>
      </header>

      {authError && <p className="error-text">{authError}</p>}

      {inquiryStatus && <p className="notice-text">{inquiryStatus}</p>}
      {aiStatus && <p className="notice-text">{aiStatus}</p>}
      {error && <p className="error-text">{error}</p>}

      <main className="focus-workspace">
        <section className="preview-grid" aria-label="이미지 미리보기">
          <PreviewPanel
            className="original-preview"
            title="원본"
            imageUrl={originalUrl}
            emptyTitle="업로드한 사진이 여기에 표시돼요"
            emptyDescription="사진을 올리면 원본과 보정 결과를 나란히 비교할 수 있어요."
            isDropActive={isDraggingFile}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <label className="compact-upload">
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                aria-label="이미지 선택"
              />
              <span>{source ? "다른 사진 올리기" : "사진 올리기"}</span>
            </label>
          </PreviewPanel>
          <PreviewPanel
            className="result-preview"
            title={
              isAiProcessing
                ? "AI 손글씨 분석 중"
                : isProcessing
                  ? "결과 처리 중"
                  : "결과"
            }
            imageUrl={resultUrl}
            emptyTitle="보정된 이미지가 여기에 표시돼요"
            emptyDescription="결과를 확인한 뒤 PNG 또는 PDF로 저장할 수 있어요."
          >
            <div className="primary-actions">
              <button
                type="button"
                onClick={() => void runAiCleaner()}
                disabled={!source || isAiProcessing}
              >
                {isAiProcessing ? "AI 처리 중" : "AI 손글씨 제거"}
              </button>
              <button
                type="button"
                onClick={() => applySettings(autoSettings)}
                disabled={!source}
              >
                자동 보정
              </button>
              <button type="button" onClick={downloadPng} disabled={!resultUrl}>
                PNG 저장
              </button>
              <button type="button" onClick={downloadPdf} disabled={!resultUrl}>
                PDF 저장
              </button>
            </div>
            <button
              className="advanced-link"
              type="button"
              onClick={() => setShowAdvanced(true)}
              disabled={!source}
            >
              세부 보정 열기
            </button>
            <button
              className="feedback-link"
              type="button"
              onClick={() => setShowFeedback((current) => !current)}
              disabled={!resultUrl}
            >
              결과가 이상한가요? 제보하기
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
          </PreviewPanel>
        </section>
      </main>

      <section className="quiet-info" aria-label="서비스 안내">
        <span>WebGPU 브라우저 AI 처리 · 서버 저장 없음 · 원본은 기기 밖으로 전송되지 않음</span>
        <button
          className="text-link-button"
          type="button"
          onClick={() => setShowInquiry(true)}
        >
          학원/과외 대량 사용 문의
        </button>
        <nav className="footer-links" aria-label="사이트 정보">
          {infoLinks.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </section>

      {showAdvanced && (
        <AdvancedModal
          settings={settings}
          onClose={() => setShowAdvanced(false)}
          onPreset={applySettings}
          onSlider={updateSlider}
          onGrayscale={(grayscale) => {
            setAiSource(null);
            setAiStatus("");
            setSettings((current) => ({ ...current, grayscale }));
          }}
          disabled={!source}
        />
      )}

      {showInquiry && (
        <InquiryModal
          inquiry={inquiry}
          status={inquiryStatus}
          onChange={updateInquiry}
          onClose={() => setShowInquiry(false)}
        />
      )}
    </div>
  );
}

function AdvancedModal({
  settings,
  disabled,
  onClose,
  onPreset,
  onSlider,
  onGrayscale,
}: {
  settings: ImageSettings;
  disabled: boolean;
  onClose: () => void;
  onPreset: (settings: ImageSettings) => void;
  onSlider: (key: SliderKey, value: number) => void;
  onGrayscale: (checked: boolean) => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="advanced-modal">
        <div className="modal-head">
          <div>
            <h2>세부 보정</h2>
            <p>필요할 때만 조절하세요. 기본은 자동 보정으로 충분합니다.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        <div className="advanced-body">
          <div className="preset-section">
            <strong>빠른 보정</strong>
            <div className="preset-row">
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset.label}
                  onClick={() => onPreset(preset.settings)}
                  disabled={disabled}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
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
                    onSlider(slider.key, Number(event.target.value))
                  }
                  disabled={disabled}
                />
              </label>
            ))}
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.grayscale}
                onChange={(event) => onGrayscale(event.target.checked)}
                disabled={disabled}
              />
              <span>흑백 변환</span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

function PreviewPanel({
  className,
  title,
  imageUrl,
  emptyTitle,
  emptyDescription,
  isDropActive = false,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  className: string;
  title: string;
  imageUrl: string;
  emptyTitle: string;
  emptyDescription: string;
  isDropActive?: boolean;
  onDragEnter?: (event: DragEvent<HTMLElement>) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  children?: ReactNode;
}) {
  return (
    <article
      className={`preview-panel ${className}${isDropActive ? " drop-active" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="preview-title">{title}</div>
      <div className="image-frame">
        {isDropActive && (
          <div className="drop-overlay">
            <strong>사진을 여기에 놓으세요</strong>
            <span>이미지 파일을 바로 불러옵니다.</span>
          </div>
        )}
        {imageUrl ? (
          <img src={imageUrl} alt={`${title} 미리보기`} />
        ) : (
          <div className="empty-preview">
            <strong>{emptyTitle}</strong>
            <span>{emptyDescription}</span>
          </div>
        )}
      </div>
      {children && <div className="preview-actions">{children}</div>}
    </article>
  );
}

function InquiryModal({
  inquiry,
  status,
  onChange,
  onClose,
}: {
  inquiry: InquiryForm;
  status: string;
  onChange: (key: keyof InquiryForm, value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="pricing-modal inquiry-modal">
        <div className="modal-head">
          <div>
            <h2>제휴 문의</h2>
            <p>학원, 과외쌤, 교육팀 제휴나 대량 사용 문의를 남겨주세요.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>

        <form
          className="inquiry-form"
          action={formspreeEndpoint}
          method="POST"
        >
          <input type="hidden" name="_subject" value="[문제만] 제휴/학원 문의" />
          <input type="hidden" name="service" value="문제만" />
          <label>
            이름
            <input
              name="name"
              value={inquiry.name}
              onChange={(event) => onChange("name", event.target.value)}
              placeholder="홍길동"
            />
          </label>
          <label>
            연락받을 이메일
            <input
              type="email"
              name="email"
              value={inquiry.email}
              onChange={(event) => onChange("email", event.target.value)}
              placeholder="name@example.com"
              required
            />
          </label>
          <label>
            기관/학원명
            <input
              name="organization"
              value={inquiry.organization}
              onChange={(event) => onChange("organization", event.target.value)}
              placeholder="문제만학원"
            />
          </label>
          <label>
            문의 내용
            <textarea
              name="message"
              value={inquiry.message}
              onChange={(event) => onChange("message", event.target.value)}
              placeholder="예: 학원에서 학생 50명 정도가 쓸 예정입니다."
              rows={5}
              required
            />
          </label>
          {status && <p className="notice-text">{status}</p>}
          <button type="submit">
            문의 보내기
          </button>
        </form>
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

function loadFeedback(): Feedback[] {
  try {
    const saved = localStorage.getItem(feedbackKey);
    return saved ? (JSON.parse(saved) as Feedback[]) : [];
  } catch {
    return [];
  }
}

function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    return "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
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

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}
