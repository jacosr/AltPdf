document.getElementById('save').addEventListener('click', async () => {
  await window.altpdf.saveFile();
});
