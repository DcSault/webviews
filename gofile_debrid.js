const puppeteer = require('puppeteer');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Attendre un délai défini (en ms)
 */
async function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Nettoyer le nom du fichier en remplaçant les caractères spéciaux
 */
function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

/**
 * Vérifie si l'extension correspond à une image
 */
function estImage(extension) {
  if (!extension) return false;
  const EXTENSIONS_IMAGE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
  return EXTENSIONS_IMAGE.includes(extension.toLowerCase());
}

/**
 * Vérifie si l'extension correspond à une vidéo
 */
function estVideo(extension) {
  if (!extension) return false;
  const EXTENSIONS_VIDEO = ['.mp4', '.webm', '.avi', '.mkv', '.mov'];
  return EXTENSIONS_VIDEO.includes(extension.toLowerCase());
}

/**
 * Lance l'extraction en simulant la navigation et déclenche le téléchargement via un clic
 */
async function lancerExtraction(urlGofile, downloadFolder) {
  console.log(`Démarrage de l'extraction pour ${urlGofile}`);

  // Définir le dossier de téléchargement temporaire
  const tempDownloadFolder = path.join(__dirname, 'temp_downloads', uuidv4());
  await fsPromises.mkdir(tempDownloadFolder, { recursive: true });

  try {
    // Lancement de Puppeteer et configuration du dossier de téléchargement via CDP
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
      defaultViewport: { width: 1280, height: 800 }
    });

    const page = await browser.newPage();

    // Configurer le comportement de téléchargement pour enregistrer dans le dossier souhaité
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadFolder
    });

    // Paramétrer quelques en-têtes pour se rapprocher d'un navigateur réel
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');

    console.log("Navigation vers la page...");
    await page.goto(urlGofile, { waitUntil: 'networkidle2', timeout: 60000 });
    await attendre(5000);

    // Optionnel : simuler un défilement de la page pour charger tout le contenu
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Utiliser page.$$ pour récupérer tous les boutons et filtrer ceux contenant "download" ou "télécharger"
    const buttons = await page.$$('button');
    console.log(`Nombre de boutons trouvés : ${buttons.length}`);
    for (const button of buttons) {
      const text = await page.evaluate(el => el.textContent, button);
      if (/download|télécharger/i.test(text)) {
        try {
          console.log(`Clic sur le bouton avec le texte : ${text.trim()}`);
          await button.click();
          await attendre(2000 + Math.random() * 2000);
        } catch (err) {
          console.error("Erreur lors du clic sur download :", err.message);
        }
      }
    }

    console.log("Attente de la fin des téléchargements...");
    await attendre(15000);

    await browser.close();

    // Trier les fichiers téléchargés et créer les métadonnées
    const downloadedFiles = await moveAndSortDownloads(tempDownloadFolder);
    console.log("Opération de téléchargement et de tri terminée.");
    
    return downloadedFiles;
  } catch (error) {
    console.error("Erreur lors de l'extraction :", error);
    // Nettoyer le dossier temporaire en cas d'erreur
    try {
      await fsPromises.rm(tempDownloadFolder, { recursive: true });
    } catch (err) {
      console.error("Erreur lors du nettoyage du dossier temporaire :", err);
    }
    throw error;
  }
}

/**
 * Après téléchargement, déplace et trie les fichiers du dossier de téléchargement
 * dans les sous-dossiers "image" et "video" et retourne les métadonnées.
 */
async function moveAndSortDownloads(downloadFolder) {
  const mediaDir = path.join(__dirname, 'data', 'media');
  const imagesDir = path.join(mediaDir, 'images');
  const videosDir = path.join(mediaDir, 'videos');
  const downloadedFiles = [];

  // S'assurer que les dossiers de destination existent
  await fsPromises.mkdir(imagesDir, { recursive: true });
  await fsPromises.mkdir(videosDir, { recursive: true });

  const files = await fsPromises.readdir(downloadFolder);
  for (const file of files) {
    const filePath = path.join(downloadFolder, file);
    const stats = await fsPromises.stat(filePath);
    
    if (stats.isFile()) {
      const ext = path.extname(file);
      let type = 'other';
      let destinationDir = null;
      let newFilename = `${uuidv4()}${ext}`;

      if (estImage(ext)) {
        type = 'image';
        destinationDir = imagesDir;
      } else if (estVideo(ext)) {
        type = 'video';
        destinationDir = videosDir;
      }

      if (destinationDir) {
        const destinationPath = path.join(destinationDir, newFilename);
        console.log(`Déplacement de ${file} vers ${destinationPath}`);
        
        try {
          await fsPromises.rename(filePath, destinationPath);

          // Créer les métadonnées pour le fichier
          downloadedFiles.push({
            id: uuidv4(),
            type,
            sender: 'Gofile',
            description: `Importé depuis ${file}`,
            originalName: file,
            filename: newFilename,
            filePath: `data/media/${type === 'image' ? 'images' : 'videos'}/${newFilename}`,
            mediaType: type === 'image' ? 'image/jpeg' : 'video/mp4',
            size: stats.size,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          console.error(`Erreur lors du déplacement du fichier ${file}:`, err);
        }
      } else {
        // Supprimer les fichiers qui ne sont ni des images ni des vidéos
        try {
          await fsPromises.unlink(filePath);
          console.log(`Fichier non supporté supprimé : ${file}`);
        } catch (err) {
          console.error(`Erreur lors de la suppression du fichier ${file}:`, err);
        }
      }
    }
  }

  // Nettoyer le dossier de téléchargement temporaire
  try {
    await fsPromises.rm(downloadFolder, { recursive: true });
    console.log('Dossier de téléchargement temporaire nettoyé');
  } catch (err) {
    console.error('Erreur lors du nettoyage du dossier temporaire:', err);
  }

  return downloadedFiles;
}

// Exporter la fonction
module.exports = {
  lancerExtraction
};