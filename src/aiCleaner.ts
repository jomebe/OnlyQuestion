import type { InferenceSession } from "onnxruntime-web";

const tileSize = 512;
const overlap = 96;
const modelPath = "models/handwriting-cleaner.onnx";
const modelManifestPath = "models/handwriting-cleaner.json";

let runtimePromise: Promise<typeof import("onnxruntime-web/webgpu")> | null = null;
let sessionPromise: Promise<InferenceSession> | null = null;
let activeBackend = "WASM";

type ExternalDataEntry = {
  path: string;
  file: string;
};

export type AiCleanResult = {
  dataUrl: string;
  backend: string;
};

export async function removeHandwriting(
  image: HTMLImageElement,
  maxSide = 2200,
): Promise<AiCleanResult> {
  const ort = await getRuntime();
  const session = await getSession();
  const scale = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext) {
    throw new Error("Canvas is not available.");
  }
  sourceContext.drawImage(image, 0, 0, width, height);
  const source = sourceContext.getImageData(0, 0, width, height);

  const cleanSum = new Float32Array(width * height);
  const maskSum = new Float32Array(width * height);
  const weightSum = new Float32Array(width * height);
  const positionsX = buildPositions(width);
  const positionsY = buildPositions(height);

  for (const y of positionsY) {
    for (const x of positionsX) {
      const tensorData = readTile(source.data, width, height, x, y);
      const prediction = await session.run({
        image: new ort.Tensor("float32", tensorData, [
          1,
          3,
          tileSize,
          tileSize,
        ]),
      });
      const output = prediction.prediction;
      if (!(output.data instanceof Float32Array)) {
        throw new Error("Unexpected model output.");
      }
      accumulateTile(
        output.data,
        cleanSum,
        maskSum,
        weightSum,
        width,
        height,
        x,
        y,
      );
    }
  }

  const result = new ImageData(
    new Uint8ClampedArray(source.data),
    width,
    height,
  );
  const cleanOutput = new Float32Array(width * height);
  const maskProbability = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const weight = Math.max(weightSum[pixel], 1e-6);
    cleanOutput[pixel] = sigmoid(cleanSum[pixel] / weight) * 255;
    maskProbability[pixel] = sigmoid(maskSum[pixel] / weight);
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const probability = localMaximum(maskProbability, width, height, x, y);
    const blend = smoothstep(0.38, 0.55, probability);
    if (blend <= 0) {
      continue;
    }
    const offset = pixel * 4;
    result.data[offset] = mix(result.data[offset], cleanOutput[pixel], blend);
    result.data[offset + 1] = mix(
      result.data[offset + 1],
      cleanOutput[pixel],
      blend,
    );
    result.data[offset + 2] = mix(
      result.data[offset + 2],
      cleanOutput[pixel],
      blend,
    );
    result.data[offset + 3] = 255;
  }

  sourceContext.putImageData(result, 0, 0);
  return {
    dataUrl: sourceCanvas.toDataURL("image/png"),
    backend: activeBackend,
  };
}

async function getSession() {
  if (!sessionPromise) {
    const ort = await getRuntime();
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
    const hasWebGpu = "gpu" in navigator;
    activeBackend = hasWebGpu ? "WebGPU" : "WASM";
    const baseUrl = import.meta.env.BASE_URL;
    const manifestResponse = await fetch(`${baseUrl}${modelManifestPath}`);
    if (!manifestResponse.ok) {
      throw new Error("Failed to load the AI model manifest.");
    }
    const manifest = (await manifestResponse.json()) as ExternalDataEntry[];
    sessionPromise = ort.InferenceSession.create(
      `${baseUrl}${modelPath}`,
      {
        executionProviders: hasWebGpu ? ["webgpu", "wasm"] : ["wasm"],
        externalData: manifest.map((entry) => ({
          path: entry.path,
          data: `${baseUrl}models/${entry.file}`,
        })),
        graphOptimizationLevel: "all",
      },
    ).catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("onnxruntime-web/webgpu");
  }
  return runtimePromise;
}

function buildPositions(length: number) {
  if (length <= tileSize) {
    return [0];
  }
  const stride = tileSize - overlap;
  const positions: number[] = [];
  for (let position = 0; position < length - tileSize; position += stride) {
    positions.push(position);
  }
  positions.push(length - tileSize);
  return positions;
}

function readTile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
) {
  const area = tileSize * tileSize;
  const tensor = new Float32Array(area * 3);
  tensor.fill(1);

  const tileWidth = Math.min(tileSize, width - startX);
  const tileHeight = Math.min(tileSize, height - startY);
  for (let y = 0; y < tileHeight; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const sourceOffset = ((startY + y) * width + startX + x) * 4;
      const targetOffset = y * tileSize + x;
      tensor[targetOffset] = pixels[sourceOffset] / 255;
      tensor[area + targetOffset] = pixels[sourceOffset + 1] / 255;
      tensor[area * 2 + targetOffset] = pixels[sourceOffset + 2] / 255;
    }
  }
  return tensor;
}

function accumulateTile(
  output: Float32Array,
  cleanSum: Float32Array,
  maskSum: Float32Array,
  weightSum: Float32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
) {
  const area = tileSize * tileSize;
  const tileWidth = Math.min(tileSize, width - startX);
  const tileHeight = Math.min(tileSize, height - startY);

  for (let y = 0; y < tileHeight; y += 1) {
    const weightY = featherWeight(
      y,
      tileHeight,
      startY > 0,
      startY + tileHeight < height,
    );
    for (let x = 0; x < tileWidth; x += 1) {
      const weightX = featherWeight(
        x,
        tileWidth,
        startX > 0,
        startX + tileWidth < width,
      );
      const weight = weightX * weightY;
      const tileOffset = y * tileSize + x;
      const imageOffset = (startY + y) * width + startX + x;
      cleanSum[imageOffset] += output[tileOffset] * weight;
      maskSum[imageOffset] += output[area + tileOffset] * weight;
      weightSum[imageOffset] += weight;
    }
  }
}

function featherWeight(
  position: number,
  length: number,
  fadeStart: boolean,
  fadeEnd: boolean,
) {
  let weight = 1;
  if (fadeStart && position < overlap) {
    weight *= Math.max(0.02, position / overlap);
  }
  if (fadeEnd && position >= length - overlap) {
    weight *= Math.max(0.02, (length - 1 - position) / overlap);
  }
  return weight;
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function localMaximum(
  values: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  let maximum = 0;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
      maximum = Math.max(maximum, values[sampleY * width + sampleX]);
    }
  }
  return maximum;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function mix(start: number, end: number, amount: number) {
  return Math.round(start + (end - start) * amount);
}
