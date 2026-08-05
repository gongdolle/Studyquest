'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session } = require('electron');
const { createJsonStore } = require('./store.cjs');
const { createAIProviders } = require('./ai-providers.cjs');
const { CredentialStore } = require('./credential-store.cjs');
const { createMediaPermissionPolicy } = require('./media-permissions.cjs');
const { assertNoCredentialFields } = require('./state-security.cjs');
const { extractDocument } = require('./document-reader.cjs');
const { defaultDataRoot, loadPortableConfig, savePortableConfig } = require('./portable-config.cjs');

const WIDGET_SCHEME = 'studyquest-widget';
const WIDGET_HOST_URL = `${WIDGET_SCHEME}://runtime/index.html`;
const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'self' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "connect-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([{
  scheme: WIDGET_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    bypassCSP: false,
    allowServiceWorkers: false,
    supportFetchAPI: false,
    corsEnabled: false,
    stream: false,
    codeCache: false,
  },
}]);

const ROOT_MARKERS = Object.freeze([
  '.studyquest-root',
  'studyquest.portable.json',
  path.join('portable', '.studyquest-root'),
]);
const MAX_ROOT_SEARCH_DEPTH = 12;
const MAX_PICKED_FILES = 25;
const MAX_PICKED_FILE_BYTES = 512 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
  '.doc',
  '.docx',
  '.rtf',
  '.hwp',
  '.hwpx',
  '.epub',
  '.tex',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.csv',
  '.ipynb',
]);

function canonicalDirectory(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  try {
    const resolved = path.resolve(candidate);
    if (!fs.statSync(resolved).isDirectory()) return null;
    return fs.realpathSync.native?.(resolved) ?? fs.realpathSync(resolved);
  } catch {
    return null;
  }
}

function containsRootMarker(directory) {
  return ROOT_MARKERS.some((marker) => fs.existsSync(path.join(directory, marker)));
}

function searchUpForRoot(startDirectory) {
  let current = canonicalDirectory(startDirectory);
  for (let depth = 0; current && depth <= MAX_ROOT_SEARCH_DEPTH; depth += 1) {
    if (containsRootMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolvePortableRoot() {
  const candidates = [
    process.env.STUDYQUEST_ROOT,
    process.env.PORTABLE_EXECUTABLE_DIR,
    path.dirname(process.execPath),
    __dirname,
    process.cwd(),
  ];

  try {
    candidates.push(app.getAppPath());
  } catch {
    // app.getAppPath can be unavailable extremely early during bootstrap.
  }

  for (const candidate of candidates) {
    const found = searchUpForRoot(candidate);
    if (found) return found;
  }

  // A copied win-unpacked directory may intentionally omit the development marker.
  if (app.isPackaged) {
    return canonicalDirectory(process.env.PORTABLE_EXECUTABLE_DIR)
      ?? canonicalDirectory(path.dirname(process.execPath));
  }

  const developmentRoot = canonicalDirectory(path.resolve(__dirname, '..'));
  if (
    developmentRoot &&
    fs.existsSync(path.join(developmentRoot, 'electron', 'main.cjs'))
  ) {
    return developmentRoot;
  }

  throw new Error('StudyQuest portable root marker was not found.');
}

const portableRoot = resolvePortableRoot();
const portableConfig = loadPortableConfig(portableRoot, process.env);
const dataRoot = portableConfig.dataRoot;
const runtimePaths = Object.freeze({
  appData: path.join(dataRoot, 'appData'),
  userData: path.join(dataRoot, 'userData'),
  sessionData: path.join(dataRoot, 'sessionData'),
  temp: path.join(dataRoot, 'temp'),
  logs: path.join(dataRoot, 'logs'),
  crashDumps: path.join(dataRoot, 'crashDumps'),
  downloads: path.join(dataRoot, 'downloads'),
  state: path.join(dataRoot, 'state'),
  cache: path.join(dataRoot, 'cache'),
});

for (const directory of Object.values(runtimePaths)) {
  fs.mkdirSync(directory, { recursive: true });
}

process.env.STUDYQUEST_ROOT = portableRoot;
process.env.TEMP = runtimePaths.temp;
process.env.TMP = runtimePaths.temp;
process.env.ELECTRON_CACHE = path.join(runtimePaths.cache, 'electron');
process.env.ELECTRON_BUILDER_CACHE = path.join(runtimePaths.cache, 'electron-builder');

for (const [name, directory] of Object.entries({
  appData: runtimePaths.appData,
  userData: runtimePaths.userData,
  sessionData: runtimePaths.sessionData,
  temp: runtimePaths.temp,
  logs: runtimePaths.logs,
  crashDumps: runtimePaths.crashDumps,
  downloads: runtimePaths.downloads,
})) {
  app.setPath(name, directory);
}
app.setAppLogsPath(runtimePaths.logs);

const stateStore = createJsonStore(path.join(runtimePaths.state, 'studyquest.json'));
const credentialStore = new CredentialStore({
  filePath: path.join(dataRoot, 'credentials', 'providers.v1.json'),
  safeStorage,
});
const schemasRoot = [
  path.join(app.getAppPath(), 'schemas'),
  path.join(portableRoot, 'schemas'),
].find((candidate) => fs.existsSync(candidate));
if (!schemasRoot) throw new Error('StudyQuest response schemas were not found.');
const aiProviders = createAIProviders({
  portableRoot,
  schemasRoot,
  dataRoot,
  cliPaths: portableConfig.cliPaths,
  credentialStore,
  appRoot: app.getAppPath(),
});

let mainWindow = null;
let loadedAppUrl = null;

function isLoopbackUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isTrustedNavigation(rawUrl) {
  if (!loadedAppUrl) return false;
  try {
    const target = new URL(rawUrl);
    const loaded = new URL(loadedAppUrl);
    if (loaded.protocol === 'file:') {
      return (
        target.protocol === 'file:' &&
        loaded.hostname === '' &&
        target.hostname === '' &&
        target.pathname === loaded.pathname
      );
    }
    return target.origin === loaded.origin;
  } catch {
    return false;
  }
}

function isTrustedWidgetHostUrl(rawUrl) {
  try {
    return new URL(rawUrl).href === WIDGET_HOST_URL;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted IPC sender.');
  }
  if (event.senderFrame?.parent) throw new Error('IPC is only available to the main frame.');
  if (!isTrustedNavigation(event.senderFrame?.url ?? event.sender.getURL())) {
    throw new Error('IPC sender URL is not trusted.');
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    assertTrustedSender(event);
    return handler(payload, event);
  });
}

function isTrustedMainContents(webContents) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && webContents === mainWindow.webContents
    && isTrustedNavigation(webContents.getURL()),
  );
}

const mediaPermissions = createMediaPermissionPolicy({
  isTrusted: isTrustedMainContents,
  isTrustedFrame: (details) => (
    details?.isMainFrame === true
    && isTrustedNavigation(details.requestingUrl ?? '')
  ),
});

async function pickDocuments() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '학습 자료 선택',
    buttonLabel: '등록',
    properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    filters: [
      {
        name: '학습 자료',
        extensions: [...ALLOWED_DOCUMENT_EXTENSIONS].map((extension) => extension.slice(1)),
      },
    ],
  });
  if (result.canceled) return [];

  const files = [];
  for (const selectedPath of result.filePaths.slice(0, MAX_PICKED_FILES)) {
    try {
      const extension = path.extname(selectedPath).toLowerCase();
      if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) continue;
      const linkStats = await fs.promises.lstat(selectedPath);
      if (linkStats.isSymbolicLink() || !linkStats.isFile()) continue;
      const realPath = await fs.promises.realpath(selectedPath);
      const stats = await fs.promises.stat(realPath);
      if (!stats.isFile() || stats.size > MAX_PICKED_FILE_BYTES) continue;
      const extraction = await extractDocument(realPath, { extension, size: stats.size });
      files.push({
        name: path.basename(realPath),
        path: realPath,
        size: stats.size,
        ...extraction,
      });
    } catch {
      // Files that disappear or become inaccessible after selection are omitted.
    }
  }
  return files;
}

function portableConfigInput(overrides = {}) {
  return {
    dataRoot: portableConfig.dataRootIsDefault ? null : portableConfig.dataRoot,
    cliPaths: { ...portableConfig.cliPaths },
    ...overrides,
  };
}

function schedulePortableRelaunch() {
  const timer = setTimeout(() => {
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  }, 500);
  timer.unref?.();
}

async function pickDataRoot() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'StudyQuest 데이터 저장 폴더 선택',
    buttonLabel: '이 폴더 사용',
    defaultPath: dataRoot,
    properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const selected = await fs.promises.realpath(result.filePaths[0]);
    await savePortableConfig(portableRoot, portableConfigInput({ dataRoot: selected }), process.env);
    schedulePortableRelaunch();
    return { ok: true, restarting: true };
  } catch (error) {
    return { ok: false, error: cleanBootstrapError(error) };
  }
}

async function useDefaultDataRoot() {
  try {
    await savePortableConfig(portableRoot, portableConfigInput({ dataRoot: null }), process.env);
    schedulePortableRelaunch();
    return { ok: true, restarting: true };
  } catch (error) {
    return { ok: false, error: cleanBootstrapError(error) };
  }
}

function validateCliProvider(provider) {
  if (provider !== 'codex') {
    throw new TypeError('Unsupported CLI provider.');
  }
  return provider;
}

async function pickCliExecutable(providerInput) {
  try {
    const provider = validateCliProvider(providerInput);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Codex CLI 실행 파일 선택',
      buttonLabel: '이 실행 파일 사용',
      defaultPath: portableConfig.cliPaths[provider] ?? portableRoot,
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Windows 실행 파일', extensions: ['exe', 'com'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const selected = result.filePaths[0];
    const linkStats = await fs.promises.lstat(selected);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
      throw new TypeError('CLI 경로는 실제 실행 파일이어야 합니다.');
    }
    const cliPaths = { ...portableConfig.cliPaths, [provider]: await fs.promises.realpath(selected) };
    await savePortableConfig(portableRoot, portableConfigInput({ cliPaths }), process.env);
    schedulePortableRelaunch();
    return { ok: true, restarting: true };
  } catch (error) {
    return { ok: false, error: cleanBootstrapError(error) };
  }
}

async function useAutomaticCli(providerInput) {
  try {
    const provider = validateCliProvider(providerInput);
    const cliPaths = { ...portableConfig.cliPaths, [provider]: null };
    await savePortableConfig(portableRoot, portableConfigInput({ cliPaths }), process.env);
    schedulePortableRelaunch();
    return { ok: true, restarting: true };
  } catch (error) {
    return { ok: false, error: cleanBootstrapError(error) };
  }
}

function registerIpcHandlers() {
  handle('studyquest:runtime:get-info', async () => ({
    portableRoot,
    dataRoot,
    defaultDataRoot: defaultDataRoot(portableRoot),
    dataRootIsDefault: portableConfig.dataRootIsDefault,
    configPath: portableConfig.configPath,
    cliPaths: { ...portableConfig.cliPaths },
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));
  handle('studyquest:runtime:pick-data-root', async () => pickDataRoot());
  handle('studyquest:runtime:use-default-data-root', async () => useDefaultDataRoot());
  handle('studyquest:runtime:pick-cli-executable', async (provider) => pickCliExecutable(provider));
  handle('studyquest:runtime:use-automatic-cli', async (provider) => useAutomaticCli(provider));
  handle('studyquest:state:load', async () => stateStore.load());
  handle('studyquest:state:save', async (state) => {
    assertNoCredentialFields(state);
    return stateStore.save(state);
  });
  handle('studyquest:files:pick-documents', async () => pickDocuments());
  handle('studyquest:ai:status', async () => aiProviders.status());
  handle('studyquest:ai:invoke', async (request) => aiProviders.invoke(request));
  handle('studyquest:ai:cancel', async (requestId) => aiProviders.cancel(requestId));
  handle('studyquest:credentials:set', async (request) => aiProviders.configureApi(request));
  handle('studyquest:credentials:remove', async (provider) => aiProviders.removeApi(provider));
  handle('studyquest:credentials:test', async (provider) => aiProviders.testApi(provider));
  handle('studyquest:audio:arm-permission', async () => mediaPermissions.arm());
  handle('studyquest:audio:transcribe', async (request) => aiProviders.transcribe(request));
}

function findRendererEntry() {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(portableRoot, 'dist', 'index.html'),
    path.resolve(__dirname, '..', 'dist', 'index.html'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findWidgetAsset(fileName) {
  const candidates = [
    path.join(app.getAppPath(), 'dist', fileName),
    path.join(portableRoot, 'dist', fileName),
    path.resolve(__dirname, '..', 'dist', fileName),
    path.join(app.getAppPath(), 'public', fileName),
    path.join(portableRoot, 'public', fileName),
    path.resolve(__dirname, '..', 'public', fileName),
  ];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) ?? null;
}

function registerWidgetProtocol() {
  const routes = new Map([
    ['/index.html', {
      path: findWidgetAsset('widget-host.html'),
      contentType: 'text/html; charset=utf-8',
    }],
    ['/widget-host.js', {
      path: findWidgetAsset('widget-host.js'),
      contentType: 'text/javascript; charset=utf-8',
    }],
  ]);
  if ([...routes.values()].some((asset) => !asset.path)) {
    throw new Error('StudyQuest isolated widget runtime assets were not found.');
  }

  protocol.handle(WIDGET_SCHEME, async (request) => {
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    const asset = parsed.hostname === 'runtime' && request.method === 'GET'
      ? routes.get(parsed.pathname)
      : null;
    if (!asset || parsed.search || parsed.hash) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
      });
    }
    const body = await fs.promises.readFile(asset.path);
    return new Response(body, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': WIDGET_CSP,
        'content-type': asset.contentType,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}

function registerWidgetRequestBoundary() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'], types: ['mainFrame', 'subFrame'] },
    (details, callback) => {
      const allowed = details.resourceType === 'mainFrame'
        ? isTrustedNavigation(details.url)
        : isTrustedWidgetHostUrl(details.url);
      callback({ cancel: !allowed });
    },
  );
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedNavigation(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) {
      if (!isTrustedNavigation(details.url)) details.preventDefault();
      return;
    }
    const directChild = details.frame?.parent === mainWindow?.webContents.mainFrame;
    if (!directChild || !isTrustedWidgetHostUrl(details.url)) details.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const developmentUrl = process.env.STUDYQUEST_DEV_SERVER_URL
    ?? process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && developmentUrl && isLoopbackUrl(developmentUrl)) {
    loadedAppUrl = new URL(developmentUrl).toString();
    await mainWindow.loadURL(loadedAppUrl);
    return;
  }

  const rendererEntry = findRendererEntry();
  if (!rendererEntry) throw new Error('StudyQuest renderer bundle was not found.');
  loadedAppUrl = new URL(`file:///${rendererEntry.replace(/\\/g, '/')}`).toString();
  await mainWindow.loadFile(rendererEntry);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerWidgetProtocol();
    registerWidgetRequestBoundary();
    registerIpcHandlers();
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(mediaPermissions.canRequest(webContents, permission, details));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => (
      mediaPermissions.canCheck(webContents, permission, details)
    ));
    await createMainWindow();
  }).catch((error) => {
    console.error(cleanBootstrapError(error));
    app.quit();
  });
}

function cleanBootstrapError(error) {
  return String(error?.message ?? error ?? 'StudyQuest failed to start.')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 1_000);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => console.error(cleanBootstrapError(error)));
  }
});

app.on('before-quit', () => aiProviders.cancelAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
