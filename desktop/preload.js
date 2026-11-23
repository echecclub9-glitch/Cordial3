// Pont minimal entre la page Cordial et l'application de bureau.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cordialDesktop", {
  platform: process.platform,
  focus: () => ipcRenderer.send("focus"),
  saveServer: (url) => ipcRenderer.invoke("save-server", url),
  screenSources: () => ipcRenderer.invoke("screen-sources"),
  selectScreen: (id) => ipcRenderer.invoke("select-screen", id),
  retry: () => ipcRenderer.send("retry"),
  changeServer: () => ipcRenderer.send("change-server"),
});
