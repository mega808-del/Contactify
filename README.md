# 📇 Contactify

**클릭 한 번으로 전화 걸기가 가능한 디지털 명함 빌더.**
기본 정보 · 주소 · 소개 · 태그 · 이력 · YouTube · 커스텀 링크를 입력하면 고급스러운 다크 카드형 명함이 완성됩니다.

**기기가 바뀌어도 데이터는 그대로** — 회원가입/로그인으로 클라우드 동기화하거나, JSON/CSV/vCard 백업 파일로 내보내기·가져오기가 가능합니다.

## ✨ 주요 기능

| 구분 | 기능 |
|---|---|
| ① 기본 정보 | 이름 · 직책 · 회사 · 이메일 · 홈페이지 · **주소(상세 포함)** · **전화번호** |
| 이미지 업로드 | 프로필 사진 / 회사 로고 업로드 + 즉시 미리보기 (클릭 & 드래그앤드롭) |
| ② 소개·태그 | 자기소개 Textarea(글자수 표시), 태그 칩 — Enter/추가 버튼 등록, ✕ 삭제 |
| ③ 이력·링크 | [+ 이력 추가] 동적 생성/삭제, YouTube 임베드, 링크 제목+URL 세트 동적 추가/삭제 |
| ④ 저장·출력 | [💾 저장 & 보기] → 명함 화면 전환, 인쇄, 공유, vCard(.vcf) 다운로드 |
| Click-to-Call | 명함의 전화번호를 `<a href="tel:...">` 로 출력 — 탭하면 전화 앱 실행 |
| 👤 계정·동기화 | 이메일 회원가입/로그인 → 명함을 **사용자 ID에 매핑**해 중앙 DB 저장, 새 기기에서 로그인 시 자동 동기화 |
| 📦 백업·이관 | 전체 명함 **JSON / CSV / vCard 내보내기**, 파일 업로드로 **한 번에 가져오기** (합치기/덮어쓰기 선택) |
| 🗂 내 명함 갤러리 | 여러 명함 저장·관리, 해시 라우팅(`#card/:id`)으로 명함 직접 공유 |

## 🚀 실행 방법

```bash
npm start        # http://localhost:3000
```

기본은 JSON 파일 DB 모드로 실행됩니다.
`npm i better-sqlite3` 후 재시작하면 자동으로 **SQLite 모드**로 전환됩니다.

### ☁️ 데스크탑 ↔ 모바일 실제 동기화 (클라우드 배포)

`localhost`에서는 다른 기기가 접근할 수 없습니다. 어디서나 접속 가능한 HTTPS 주소를 만들려면
**Render (무료) + Turso (무료 원격 DB)** 조합으로 배포하세요:

1. **Turso DB 생성** — [turso.tech](https://turso.tech) 가입 (무료, 카드 불필요) → 데이터베이스 생성 → `Database URL`(`libsql://...`)과 `Auth Token` 복사
2. **Render 배포** — [dashboard.render.com](https://dashboard.render.com) → New → Blueprint → 이 리포지토리 선택 → `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 값 입력
3. 배포가 끝나면 `https://contactify-xxxx.onrender.com` 주소가 생성됩니다 — 데스크탑/모바일 어디서든 이 주소로 접속해 **같은 계정으로 로그인**하면 명함이 자동 동기화됩니다

> ℹ️ Render 무료 플랜은 15분간 요청이 없으면 슬립하며, 첫 접속 시 ~1분 정도 깨어나는 시간이 걸립니다.
> 데이터는 Turso(원격 DB)에 저장되므로 슬립/재시작과 무관하게 유지됩니다.

로컬 개발 시 `TURSO_*` 환경변수를 설정하면 원격 DB 모드로, 없으면 기존처럼 로컬 DB로 동작합니다.

`index.html`을 브라우저로 직접 열면 서버 없이 LocalStorage 모드로 동작하며,
이때 로그인은 "데모 모드"(로컬 전용 계정)로 처리됩니다.

## 🔄 기기 변경 시 데이터 이관 (2가지 방법)

### 방법 1 — 계정 동기화 (권장)
1. 기존 기기에서 **로그인/회원가입** → 명함이 사용자 ID에 매핑되어 서버 DB에 저장
2. 새 기기에서 **같은 계정으로 로그인** → 저장된 명함 목록이 **자동으로 동기화**

### 방법 2 — 백업 파일
1. 기존 기기: **데이터 관리 → JSON 내보내기** (또는 CSV/vCard)
2. 새 기기: **데이터 가져오기**에 파일 업로드 → 합치기(기존+백업) 또는 덮어쓰기 선택

## 🔌 REST API

인증이 필요한 API는 `Authorization: Bearer <token>` 헤더를 사용합니다.

| Method | Endpoint | 설명 |
|---|---|---|
| POST | `/api/auth/signup` | 회원가입 `{email, password, nickname}` → `{user, token}` |
| POST | `/api/auth/login` | 로그인 `{email, password}` → `{user, token}` |
| GET | `/api/auth/google/start` | 구글 로그인 시작 (구글 동의 화면으로 302) |
| GET | `/api/auth/google/callback` | 구글 OAuth 콜백 → `#google-token=...` 리디렉션 |
| GET | `/api/me` | 현재 사용자 조회 (토큰 검증) |
| GET | `/api/cards` | 내 명함 목록 |
| POST | `/api/cards` | 명함 생성 `{name*, phone*, ...}` |
| GET | `/api/cards/:id` | 명함 조회 |
| PUT | `/api/cards/:id` | 명함 수정 |
| DELETE | `/api/cards/:id` | 명함 삭제 |
| POST | `/api/sync` | 일괄 동기화 `{cards:[...]}` — updatedAt 최신 우선 병합 |
| GET | `/api/export.json` / `.csv` / `.vcf` | 내 명함 전체 백업 파일 다운로드 |
| POST | `/api/import` | 백업 텍스트 일괄 등록 `{text, format?}` (JSON/CSV/vCard 자동 인식) |
| GET | `/api/cards/:id/vcf` | 명함 1장 vCard 다운로드 |
| GET | `/api/ping` | 서버 생존 확인 |

```bash
# 예시: 회원가입 → 명함 생성 → 목록 조회
curl -X POST localhost:3000/api/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"me@ex.com","password":"123456","nickname":"길동"}'
curl -X POST localhost:3000/api/cards -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"홍길동","phone":"010-1234-5678","address":"서울시 강남구..."}'
curl localhost:3000/api/cards -H "Authorization: Bearer <TOKEN>"
```

## 🗄 데이터베이스 스키마

`db/schema.sql`(MySQL 기준) / `db/schema.json`(구조 문서) 참고.

```
users (id PK, email UNIQUE, password_hash, nickname, provider?, provider_id?, created_at)
  ↓ 1:N
tokens (token PK, user_id FK→users.id)
cards (id PK, owner_id FK→users.id, name, phone, address, ..., tags/careers/links JSON, photo_data, updated_at)
```

### 🔐 구글 로그인 설정 (선택)

이메일 로그인 외에 **구글 계정으로 로그인**을 쓰려면:

1. [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성 → **API 및 서비스 → OAuth 동의 화면** → External / 개인 계정으로 설정
2. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** → 유형 *웹 애플리케이션*
3. **승인된 리디렉션 URI**에 `https://<배포주소>/api/auth/google/callback` 등록
4. 발급된 클라이언트 ID/비밀번호를 Render 환경변수에 등록:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `APP_URL` = `https://<배포주소>` (OAuth redirect_uri 계산용)
5. 미설정 시 구글 버튼은 501 오류를 반환하고, 이메일 로그인은 계속 정상 동작합니다.

OAuth 사용자는 `(provider, provider_id)`로 식별되어 별도 비밀번호 없이 저장되며, 같은 구글 계정이면 어느 기기에서 로그인해도 동일한 명함 데이터에 매핑됩니다.

- 모든 명함은 `cards.owner_id`로 사용자에 매핑 → **기기가 달라도 같은 계정이면 동일한 데이터**
- 동기화 충돌은 `updated_at` 최신 우선으로 병합 (덮어쓰기 없음)
- DB 선택 우선순위: `TURSO_DATABASE_URL` 설정 시 **Turso(원격 libSQL)** → `npm i better-sqlite3` 설치 시 **SQLite** → 그 외 **JSON 파일**(`db/data/db.json`) 폴백

## 🗂 프로젝트 구조

```
contactify/
├── index.html        # 편집 폼 + 명함 뷰 + 갤러리 + 백업 UI + 로그인 모달
├── css/style.css     # 커스텀 스타일 (포커스 애니메이션, 칩, 3D 틸트, 인쇄)
├── js/
│   ├── sync.js       # 계정(회원가입/로그인) · 클라우드 동기화 · 공용 유틸 (CT 네임스페이스)
│   ├── backup.js     # JSON/CSV/vCard 내보내기·가져오기 (RFC4180 CSV, vCard 3.0 파서)
│   └── app.js        # 다중 명함 덱 관리 · 편집/렌더 · 해시 라우팅
├── server.js         # Node 정적 서버 + REST API (auth/cards/sync/export/import)
├── render.yaml       # Render 배포 설정 (Blueprint)
├── db/
│   ├── turso-store.js# Turso/libSQL 원격 저장소 (클라우드 배포용)
│   ├── index.js      # SQLite 저장소 (better-sqlite3)
│   ├── json-store.js # JSON 파일 저장소 (폴백, 의존성 없음)
│   ├── schema.sql    # MySQL 참조 스키마
│   └── schema.json   # 스키마 문서
└── package.json
```

## 🎨 디자인

- 다크 모드 기반 고급스러운 카드 UI (Tailwind CSS + Pretendard)
- 모바일 프렌들리 반응형, 입력창/버튼 라운드 처리
- 포커스 글로우 애니메이션, 태그 칩 팝업, 명함 3D 틸트 & 광택 효과
- `prefers-reduced-motion` 대응, 인쇄용 스타일 포함
