import"./styles-B8aFwZuF.js";document.getElementById("open").addEventListener("click",async()=>{const e=chrome.runtime.getURL("full-screen.html");await chrome.tabs.create({url:e}),window.close()});
