# 마크다운 비교 편집기

원문과 수정본을 항목별로 비교·편집하고, 저장 이력(버전)·표/그림·참고문헌·코멘트를 관리하는 정적 웹앱입니다. 서버 없이 GitHub Pages에서 동작합니다.

- 사용법: [작동방법.txt](작동방법.txt)
- 원본 사이트 분석: [원본분석.txt](원본분석.txt)
- 배포: 저장소 Settings → Pages → Source 를 **GitHub Actions** 로 선택하면 `main` 푸시마다 자동 배포됩니다.
- 로컬 실행: `python -m http.server 8000` 후 http://localhost:8000
- 문서 데이터를 저장소에 넣으려면 `data/document.json`(앱의 JSON 백업 파일)을 올리세요. 브라우저에 데이터가 없는 방문자는 이 파일을 자동으로 불러옵니다.
