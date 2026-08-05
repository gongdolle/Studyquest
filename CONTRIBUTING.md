# Contributing to StudyQuest

StudyQuest에 관심을 가져주셔서 감사합니다. 이 프로젝트는 초기 개발 단계이므로 작은 수정은 바로 Pull Request로 제안할 수 있고, 데이터 구조·보안 경계·AI 공급자·학습 엔진을 크게 바꾸는 작업은 먼저 Issue에서 방향을 논의해 주세요.

보안 취약점은 Issue에 올리지 말고 [SECURITY.md](SECURITY.md)의 비공개 보고 절차를 사용하세요.

## 개발 환경

권장 환경:

- Windows 10/11 x64
- Node.js 24
- npm

```powershell
git clone https://github.com/gongdolle/Studyquest.git
cd Studyquest
npm ci
npm.cmd test
npm.cmd run desktop
```

전체 데스크톱 기능은 `npm run desktop`으로 확인합니다. `npm run dev`는 Vite renderer만 실행하므로 Electron IPC, 포터블 저장소, 문서 선택, CLI 호출을 완전히 시험할 수 없습니다.

## 작업 원칙

- 사용자 데이터와 무관한 작은 단위로 변경합니다.
- 기존 코드 스타일과 TypeScript 타입을 유지합니다.
- AI 응답 구조를 바꾸면 해당 JSON Schema와 프롬프트 테스트를 함께 수정합니다.
- 학습 엔진 동작을 바꾸면 정상·경계·실패 사례 테스트를 추가합니다.
- UI를 바꾸면 라이트·다크 모드와 최소 창 크기에서 확인합니다.
- 새로운 네트워크 요청, 파일 쓰기, 권한 또는 외부 프로세스 실행은 목적과 범위를 Pull Request에 설명합니다.
- 관련 없는 사용자 데이터, 빌드 결과, 캐시, 로그를 커밋하지 않습니다.

## 반드시 지켜야 할 포터블·보안 경계

- 기본적으로 앱이 선택한 데이터 루트 밖에 상태, 캐시, 로그, 임시 파일을 쓰지 않습니다.
- Windows 레지스트리, 시작 프로그램, 서비스, `Program Files`를 자동 수정하지 않습니다.
- API 키와 CLI 인증 정보를 일반 상태나 포터블 설정에 저장하지 않습니다.
- Codex의 기존 인증 파일을 복사하거나 변경하지 않습니다. Claude 연결은 사용자가 제공한 Anthropic API 키만 사용합니다.
- 문서와 음성의 외부 전송에는 명시적인 사용자 동작이 있어야 합니다.
- renderer에 Node.js 통합, unrestricted IPC, `webview` 또는 임의 navigation을 추가하지 않습니다.
- AI 생성 위젯의 네트워크·파일·부모 앱 접근을 허용하지 않습니다.

생성 위젯이나 Electron 보안 설정을 수정할 때는 `electron/iframe-security.test.ts`, `src/lib/sandbox-widget.test.ts`, 미디어 권한 테스트를 함께 검토하세요.

## 테스트와 빌드

Pull Request를 열기 전에 다음 명령을 실행합니다.

```powershell
npm.cmd test
npm.cmd run build
```

포터블 패키징을 바꾼 경우 다음도 실행합니다.

```powershell
npm.cmd run package:portable
```

새 기능에는 가능한 범위에서 자동화 테스트를 추가해 주세요. 외부 AI를 실제 호출해야만 통과하는 테스트나 개인 API 키에 의존하는 테스트는 기본 테스트 스위트에 넣지 않습니다.

## Pull Request 체크리스트

- 변경 목적과 사용자 영향을 설명했습니다.
- 관련 테스트를 추가하거나 기존 테스트로 충분한 이유를 설명했습니다.
- `npm.cmd test`와 `npm.cmd run build` 결과를 적었습니다.
- UI 변경이라면 라이트·다크 모드 화면을 첨부했습니다.
- 데이터 저장 위치, 네트워크, 권한, AI 비용에 미치는 영향을 적었습니다.
- 실제 API 키, CLI 인증 정보, 개인 문서, `data/`, `portable/`, `.cache/`, `.tmp/`를 포함하지 않았습니다.
- README 또는 사용자 안내가 달라지면 문서도 함께 갱신했습니다.

## 라이선스

기여물을 제출하면 해당 기여물을 프로젝트의 [Beerware License, Revision 42](LICENSE)로 배포하는 데 동의하는 것으로 간주합니다.
