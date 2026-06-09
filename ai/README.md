# 손글씨 제거 모델

AI Hub 수학 과목 자동 풀이 데이터의 깨끗한 문제 이미지와 손글씨 풀이 이미지를
합성해 학습합니다. 모델은 깨끗한 명암과 손글씨 마스크를 함께 예측합니다.

```powershell
python ai/train.py --steps 30000
python ai/export.py
```

기본 데이터 경로는 아래 위치입니다.

```text
C:\Users\dongh\Downloads\110.수학 과목 자동 풀이 데이터
```

웹은 `public/models/handwriting-cleaner.onnx`를 WebGPU로 실행합니다.
