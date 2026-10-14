import './styles.css';

document.getElementById('open').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('full-screen.html');
  await chrome.tabs.create({ url });
  window.close();
});
