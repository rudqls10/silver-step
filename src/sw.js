/**
 * Silver Step - Service Worker
 * PWA 오프라인 캐싱 및 설치 지원
 *
 * 캐싱 전략:
 *   - 정적 파일 (HTML, CSS, JS): Cache-First (빠른 로딩)
 *   - MediaPipe CDN: Network-First (항상 최신 시도)
 *   - 기타: Network-First with fallback
 */

const CACHE_NAME = 'silver-step-v2';

// 캐싱할 정적 파일 목록
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/audio.js',
  './js/counter.js',
  './js/exercises.js',
  './js/pose-mediapipe.js',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './manifest.json',
];

// MediaPipe CDN (Network-First로 처리)
const MEDIAPIPE_CDN = 'cdn.jsdelivr.net/npm/@mediapipe';
const GOOGLE_FONTS_CDN = 'fonts.googleapis.com';

// ============================
// Install - 정적 파일 프리캐싱
// ============================
self.addEventListener('install', (event) => {
  console.log('[SW] 설치 중...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 정적 파일 캐싱 중...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] 설치 완료');
        return self.skipWaiting(); // 즉시 활성화
      })
      .catch((error) => {
        console.error('[SW] 캐싱 실패:', error);
      })
  );
});

// ============================
// Activate - 이전 캐시 정리
// ============================
self.addEventListener('activate', (event) => {
  console.log('[SW] 활성화 중...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log(`[SW] 이전 캐시 삭제: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] 활성화 완료');
        return self.clients.claim(); // 모든 탭에 즉시 적용
      })
  );
});

// ============================
// Fetch - 요청 가로채기
// ============================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // MediaPipe CDN → Network-First (모델 파일은 항상 최신 시도)
  if (url.hostname.includes(MEDIAPIPE_CDN) || url.hostname.includes(GOOGLE_FONTS_CDN)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // 같은 origin의 정적 파일 → Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // 기타 외부 요청 → Network-First
  event.respondWith(networkFirst(event.request));
});

// ============================
// 캐싱 전략: Cache-First
// ============================
async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('[SW] Cache-First 실패:', error);
    // 오프라인 폴백: 메인 페이지 반환
    const cached = await caches.match('./');
    if (cached) return cached;
    return new Response('오프라인 상태입니다.', { status: 503 });
  }
}

// ============================
// 캐싱 전략: Network-First
// ============================
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.warn('[SW] Network-First 폴백:', error);
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('네트워크 연결을 확인해 주세요.', { status: 503 });
  }
}
