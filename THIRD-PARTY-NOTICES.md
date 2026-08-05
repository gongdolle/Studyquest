# Third-party notices

StudyQuest 자체 소스의 라이선스는 [LICENSE](LICENSE)를 따릅니다. 아래 구성요소는
각 저작권자와 기여자가 정한 별도 라이선스를 따르며, 이 문서는 해당 라이선스를
대체하거나 변경하지 않습니다.

이 목록은 Windows x64 포터블 빌드에 설치되는 production 의존성 트리를 기준으로
작성했습니다. 이름, 버전, 라이선스 식별자는 배포에 사용한 각 npm 패키지의
`package.json`에서 확인했고, 원문 파일 이름은 실제 게시 패키지에 들어 있는
`LICENSE`, `LICENCE`, `COPYING` 또는 동등한 파일만 기록했습니다. 게시 패키지에
별도 원문 파일이 없는 경우에는 이를 명시했으며, 연락처나 저작권 문구를 새로
만들지 않았습니다.

## Codex SDK와 번들 CLI

StudyQuest의 Windows x64 포터블 빌드는 다음 OpenAI 구성요소를 포함합니다.

| 구성요소 | 버전 | 라이선스 | 포함된 라이선스 원문 |
| --- | --- | --- | --- |
| `@openai/codex-sdk` | `0.146.0` | Apache-2.0 | `@openai/codex-sdk/LICENSE` |
| `@openai/codex` | `0.146.0` | Apache-2.0 | 게시 패키지에 별도 파일 없음; 위 SDK 패키지의 Apache-2.0 원문이 배포에 포함됨 |
| `@openai/codex` Windows x64 native package | `0.146.0-win32-x64` | Apache-2.0 | 게시 패키지에 별도 파일 없음; 위 SDK 패키지의 Apache-2.0 원문이 배포에 포함됨 |

Codex 실행 파일은 Electron이 실행할 수 있도록
`resources/app.asar.unpacked/node_modules/@openai/codex/` 아래에 풀린 상태로
포함됩니다. `@openai/codex-sdk/LICENSE` 원문은 `resources/app.asar` 안에 함께
포함됩니다. OpenAI 및 Codex 명칭은 해당 구성요소를 식별하기 위한 것이며,
StudyQuest 자체의 라이선스나 보증을 뜻하지 않습니다.

## Electron과 Chromium 런타임

Electron은 개발 의존성이지만 완성된 데스크톱 실행 파일의 런타임으로
재배포됩니다.

| 구성요소 | 버전 | 고지 위치 |
| --- | --- | --- |
| Electron | `43.2.0` | `portable/StudyQuest-win32-x64/LICENSE` |
| Chromium 및 Electron이 재배포하는 제3자 구성요소 | Electron `43.2.0`에 포함된 버전 | `portable/StudyQuest-win32-x64/LICENSES.chromium.html` |

위 두 파일은 Electron 패키징 결과물의 루트에 그대로 포함됩니다. Chromium 관련
구성요소는 여러 라이선스를 사용하므로 이 문서에서 하나의 라이선스로 축약하지
않으며, `LICENSES.chromium.html`의 원문을 기준으로 합니다.

## Production npm 의존성

| 패키지 | 버전 | 라이선스 | 게시 패키지의 라이선스 원문 |
| --- | --- | --- | --- |
| `@borewit/text-codec` | `0.2.2` | MIT | `LICENSE.txt` |
| `@napi-rs/canvas` | `1.0.3` | MIT | `LICENSE` |
| `@napi-rs/canvas-win32-x64-msvc` | `1.0.3` | MIT | 별도 파일 없음 |
| `@openai/codex` | `0.146.0` | Apache-2.0 | 별도 파일 없음; 위 Codex 절 참고 |
| `@openai/codex` Windows x64 native package | `0.146.0-win32-x64` | Apache-2.0 | 별도 파일 없음; 위 Codex 절 참고 |
| `@openai/codex-sdk` | `0.146.0` | Apache-2.0 | `LICENSE` |
| `@tokenizer/inflate` | `0.4.1` | MIT | `LICENSE` |
| `@tokenizer/token` | `0.3.0` | MIT | 별도 파일 없음 |
| `@xmldom/xmldom` | `0.9.10` | MIT | `LICENSE` |
| `ajv` | `8.20.0` | MIT | `LICENSE` |
| `bmp-js` | `0.1.0` | MIT | `LICENSE` |
| `debug` | `4.4.3` | MIT | `LICENSE` |
| `fast-deep-equal` | `3.1.3` | MIT | `LICENSE` |
| `fast-uri` | `3.1.5` | BSD-3-Clause | `LICENSE` |
| `fflate` | `0.8.3` | MIT | `LICENSE` |
| `file-type` | `22.0.1` | MIT | `license` |
| `idb-keyval` | `6.3.0` | Apache-2.0 | `LICENCE` |
| `ieee754` | `1.2.1` | BSD-3-Clause | `LICENSE` |
| `is-url` | `1.2.4` | MIT | `LICENSE-MIT` |
| `json-schema-traverse` | `1.0.0` | MIT | `LICENSE` |
| `lucide-react` | `1.28.0` | ISC | `LICENSE` |
| `ms` | `2.1.3` | MIT | `license.md` |
| `node-fetch` | `2.7.0` | MIT | `LICENSE.md` |
| `officeparser` | `7.5.1` | MIT | `LICENSE` |
| `opencollective-postinstall` | `2.0.3` | MIT | `LICENSE` |
| `pdfjs-dist` | `6.1.200` | Apache-2.0 | `LICENSE` 및 아래 추가 원문 |
| `react` | `19.2.8` | MIT | `LICENSE` |
| `react-dom` | `19.2.8` | MIT | `LICENSE` |
| `regenerator-runtime` | `0.13.11` | MIT | `LICENSE` |
| `require-from-string` | `2.0.2` | MIT | `license` |
| `scheduler` | `0.27.0` | MIT | `LICENSE` |
| `strtok3` | `10.3.5` | MIT | `LICENSE.txt` |
| `tesseract.js` | `7.0.0` | Apache-2.0 | `LICENSE.md` 및 배포 번들의 `*.LICENSE.txt` |
| `tesseract.js-core` | `7.0.0` | Apache-2.0 | `LICENSE` |
| `token-types` | `6.1.2` | MIT | `LICENSE.txt` |
| `tr46` | `0.0.3` | MIT | 별도 파일 없음 |
| `uint8array-extras` | `1.5.0` | MIT | `license` |
| `wasm-feature-detect` | `1.8.0` | Apache-2.0 | `LICENSE` |
| `webidl-conversions` | `3.0.1` | BSD-2-Clause | `LICENSE.md` |
| `whatwg-url` | `5.0.0` | MIT | `LICENSE.txt` |
| `zlibjs` | `0.3.1` | MIT | `LICENSE` |

패키지별 원문 파일은 포터블 앱의 `resources/app.asar/node_modules/` 안에 보존됩니다.
네이티브 실행 파일이나 모듈만 필요한 경우 `resources/app.asar.unpacked/`에 별도로
배치될 수 있습니다.

`pdfjs-dist`에는 최상위 `LICENSE` 외에도 배포 데이터별 라이선스 원문이 포함됩니다.
현재 포터블 빌드는 다음 파일들을 그대로 보존합니다.

- `pdfjs-dist/cmaps/LICENSE`
- `pdfjs-dist/iccs/LICENSE`
- `pdfjs-dist/standard_fonts/LICENSE_FOXIT`
- `pdfjs-dist/standard_fonts/LICENSE_LIBERATION`
- `pdfjs-dist/wasm/LICENSE_JBIG2`
- `pdfjs-dist/wasm/LICENSE_OPENJPEG`
- `pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2`
- `pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG`
- `pdfjs-dist/wasm/LICENSE_PDFJS_QCMS`
- `pdfjs-dist/wasm/LICENSE_QCMS`

## 확인 기준

이 목록은 StudyQuest `0.1.0`의 Windows x64 production 설치 트리를 기준으로 합니다.
의존성을 변경하면 실제 배포 트리와 패키지에 포함된 원문을 다시 확인해 이 문서도
함께 갱신해야 합니다.
