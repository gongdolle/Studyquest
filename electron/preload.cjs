'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  runtimeInfo: 'studyquest:runtime:get-info',
  runtimePickDataRoot: 'studyquest:runtime:pick-data-root',
  runtimeUseDefaultDataRoot: 'studyquest:runtime:use-default-data-root',
  runtimePickCliExecutable: 'studyquest:runtime:pick-cli-executable',
  runtimeUseAutomaticCli: 'studyquest:runtime:use-automatic-cli',
  stateLoad: 'studyquest:state:load',
  stateSave: 'studyquest:state:save',
  pickDocuments: 'studyquest:files:pick-documents',
  providerStatus: 'studyquest:ai:status',
  aiInvoke: 'studyquest:ai:invoke',
  aiCancel: 'studyquest:ai:cancel',
  credentialSet: 'studyquest:credentials:set',
  credentialRemove: 'studyquest:credentials:remove',
  credentialTest: 'studyquest:credentials:test',
  audioArmPermission: 'studyquest:audio:arm-permission',
  audioTranscribe: 'studyquest:audio:transcribe',
});

function copyAiRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return request;
  return {
    provider: request.provider,
    operation: request.operation,
    prompt: request.prompt,
    schemaName: request.schemaName,
    timeoutMs: request.timeoutMs,
    requestId: request.requestId,
  };
}

const bridge = Object.freeze({
  runtime: Object.freeze({
    getInfo: () => ipcRenderer.invoke(CHANNELS.runtimeInfo),
    pickDataRoot: () => ipcRenderer.invoke(CHANNELS.runtimePickDataRoot),
    useDefaultDataRoot: () => ipcRenderer.invoke(CHANNELS.runtimeUseDefaultDataRoot),
    pickCliExecutable: (provider) => ipcRenderer.invoke(CHANNELS.runtimePickCliExecutable, provider),
    useAutomaticCli: (provider) => ipcRenderer.invoke(CHANNELS.runtimeUseAutomaticCli, provider),
  }),
  state: Object.freeze({
    load: () => ipcRenderer.invoke(CHANNELS.stateLoad),
    save: (state) => ipcRenderer.invoke(CHANNELS.stateSave, state),
  }),
  files: Object.freeze({
    pickDocuments: () => ipcRenderer.invoke(CHANNELS.pickDocuments),
  }),
  ai: Object.freeze({
    status: () => ipcRenderer.invoke(CHANNELS.providerStatus),
    invoke: (request) => ipcRenderer.invoke(CHANNELS.aiInvoke, copyAiRequest(request)),
    cancel: (requestId) => ipcRenderer.invoke(CHANNELS.aiCancel, requestId),
  }),
  credentials: Object.freeze({
    set: (request) => ipcRenderer.invoke(CHANNELS.credentialSet, {
      provider: request?.provider,
      apiKey: request?.apiKey,
      model: request?.model,
    }),
    remove: (provider) => ipcRenderer.invoke(CHANNELS.credentialRemove, provider),
    test: (provider) => ipcRenderer.invoke(CHANNELS.credentialTest, provider),
  }),
  audio: Object.freeze({
    armPermission: () => ipcRenderer.invoke(CHANNELS.audioArmPermission),
    transcribe: (request) => ipcRenderer.invoke(CHANNELS.audioTranscribe, {
      bytes: request?.bytes,
      mimeType: request?.mimeType,
      language: request?.language,
    }),
  }),
});

contextBridge.exposeInMainWorld('studyQuest', bridge);
