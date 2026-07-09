# 🚶‍♂️ Silver Step (실버스텝) MVP

> AI가 지켜보는 안심 홈트레이닝 - 시니어를 위한 음성 기반 운동 코치

## 📌 프로젝트 개요

- **타깃**: 혼자 거실에서 홈트레이닝을 하는 5070 시니어
- **핵심 가치**: 3m 원거리에서 음성(VUI)과 AI 비전으로 안내하는 'Invisible UX'
- **기술 스택**: HTML + CSS + Vanilla JS + MediaPipe Pose
- **데드라인**: 2026년 8월 3일 (4주)

## 🗂️ 프로젝트 구조

```
silver step/
├── docs/                      # 기획 문서
│   ├── prd.md                 # 제품 요구사항 정의서
│   ├── roadmap.md             # 4주 로드맵
│   └── dev_principles.md      # 개발 원칙
├── src/                       # 소스 코드
│   ├── index.html             # 메인 앱 페이지
│   ├── css/
│   │   └── style.css          # 시니어 퍼스트 디자인 시스템
│   ├── js/
│   │   ├── app.js             # 앱 상태 머신 (메인 로직)
│   │   ├── pose-mediapipe.js  # MediaPipe Pose 연동
│   │   ├── pose-teachable.js  # Teachable Machine 연동
│   │   ├── audio.js           # 음성 재생 (Web Speech API)
│   │   └── counter.js         # 운동 카운팅
│   └── assets/
│       └── audio/             # TTS mp3 파일 (추후 추가)
├── test/                      # 비교 테스트 페이지
│   ├── mediapipe-test.html    # MediaPipe 단독 테스트
│   └── teachable-test.html    # Teachable Machine 단독 테스트
└── README.md
```

## 🚀 실행 방법

### 1. 개발 서버 실행

순수 HTML/JS이므로 간단한 HTTP 서버가 필요합니다:

```bash
# Python 3
cd "silver step/src"
python -m http.server 8080

# 또는 VS Code Live Server 확장 사용
```

### 2. 브라우저에서 열기

- 메인 앱: `http://localhost:8080/`
- MediaPipe 테스트: `http://localhost:8080/../test/mediapipe-test.html`
- Teachable Machine 테스트: `http://localhost:8080/../test/teachable-test.html`

### 3. 카메라 허용

- 브라우저에서 카메라 접근 권한을 허용해야 합니다
- HTTPS 또는 localhost에서만 카메라 API가 동작합니다

## 🏗️ 앱 동작 흐름

```
[시작 버튼 클릭]
    ↓
[GREETING] "안녕하세요. 오늘도 운동 시작해볼까요?"
    ↓
[WAITING_POSE] 카메라 ON, 안심위치 포즈 대기
    ↓  (서 있는 포즈 1.5초 유지)
[COUNTDOWN] 3... 2... 1...
    ↓
[EXERCISING] 스쿼트 카운팅 시작
    ↓  (5회 → 격려 음성)
    ↓  (10회 → 목표 달성)
[COMPLETE] "오늘의 운동이 끝났습니다!"
    ↓
[카카오톡 알림 발송] (3주차 구현 예정)
```

## 📋 주차별 진행 상황

- [x] **1주차**: AI 포즈 프로토타입 + 음성 에셋
- [ ] **2주차**: UI 완성 + 카메라-AI 핵심 로직 연결
- [ ] **3주차**: 카카오톡 알림 연동 + E2E 테스트
- [ ] **4주차**: 실제 시니어 현장 테스트
