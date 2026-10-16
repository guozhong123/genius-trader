import"./styles-Buss27g_.js";document.getElementById("open").addEventListener("click",async()=>{const e=chrome.runtime.getURL("full-screen.html");await chrome.tabs.create({url:e}),window.close()});
