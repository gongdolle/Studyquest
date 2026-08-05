'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const qaRoot = path.join(root, 'data', 'qa');
const qaRuntimeRoot = path.join(root, 'data', 'qa-runtime');
const outputPath = path.join(qaRoot, 'onboarding.png');

for (const directory of [qaRoot, qaRuntimeRoot]) {
  fs.mkdirSync(directory, { recursive: true });
}

for (const [name, directory] of Object.entries({
  userData: path.join(qaRuntimeRoot, 'userData'),
  sessionData: path.join(qaRuntimeRoot, 'sessionData'),
  temp: path.join(qaRuntimeRoot, 'temp'),
  logs: path.join(qaRuntimeRoot, 'logs'),
  crashDumps: path.join(qaRuntimeRoot, 'crashDumps'),
})) {
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(path.join(root, 'dist', 'index.html'));
  await window.webContents.executeJavaScript("localStorage.removeItem('studyquest-state')");
  await window.reload();
  await new Promise((resolve) => setTimeout(resolve, 800));
  const capture = async (name) => {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(qaRoot, name), image.toPNG());
  };
  await capture('onboarding.png');
  const darkInjected = await window.webContents.executeJavaScript(`(() => {
    const key = 'studyquest-state';
    const state = JSON.parse(localStorage.getItem(key) || 'null');
    if (!state) return false;
    state.preferences = { ...state.preferences, theme: 'dark' };
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  })()`);
  if (darkInjected) {
    await window.reload();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await capture('dark-onboarding.png');
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('.nav-button')]
        .find((element) => element.textContent.includes('AI와 설정'))
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await capture('dark-settings.png');
    await window.webContents.executeJavaScript(`(() => {
      const key = 'studyquest-state';
      const state = JSON.parse(localStorage.getItem(key) || 'null');
      if (!state) return;
      state.preferences = { ...state.preferences, theme: 'light' };
      localStorage.setItem(key, JSON.stringify(state));
    })()`);
    await window.reload();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const injected = await window.webContents.executeJavaScript(`(() => {
    const key = 'studyquest-state';
    const state = JSON.parse(localStorage.getItem(key) || 'null');
    if (!state) return false;
    state.interview = {
      status: 'diagnostic',
      readiness: 1,
      messages: [
        { id: 'qa-a1', role: 'assistant', content: '배울 과목과 도달 목표가 정해졌습니다. 이제 테스트 답안으로 현재 수준을 확인하겠습니다.' },
        { id: 'qa-u1', role: 'user', content: '이 과목을 배워서 새 문제를 혼자 해결할 수 있는 수준까지 가고 싶습니다.' }
      ],
      blueprint: {
        subjectName: '샘플 과목', role: 'support', dailyMinutes: 30,
        knownSummary: '기본 용어를 설명할 수 있음', unknownSummary: '새 문제에 적용하지 못함',
        goal: '새 상황에서 독립적으로 적용', successEvidence: '풀이 과정과 결과물',
        skills: [{ name: '기초 설명', prerequisites: [], reason: '선수 확인' }]
      },
      diagnosticTitle: '독립 적용을 확인하는 현재 수준 테스트',
      diagnosticOverview: '암기 여부가 아니라 설명과 전이를 확인합니다.',
      questions: [
        { id: 'qa-q1', concept: '핵심 설명', prompt: '핵심 개념을 처음 듣는 사람에게 자신의 말과 예시로 설명하세요.', difficulty: 0.4, evaluationGuide: '정확성과 설명력' },
        { id: 'qa-q2', concept: '새 상황 적용', prompt: '익숙하지 않은 상황에 적용하는 과정을 단계별로 제시하세요.', difficulty: 0.7, evaluationGuide: '전이와 독립성' }
      ],
      answers: {}
    };
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  })()`);
  if (injected) {
    await window.reload();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await capture('interview-diagnostic.png');
  }
  for (const [label, name] of [
    ['AI와 설정', 'settings.png'],
  ]) {
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('.nav-button')]
        .find((element) => element.textContent.includes(${JSON.stringify(label)}))
        ?.click();
    `);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await capture(name);
  }
  await window.webContents.executeJavaScript("localStorage.removeItem('studyquest-state')");
  window.setSize(720, 900);
  await window.reload();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await capture('mobile-onboarding.png');
  console.log(outputPath);
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
