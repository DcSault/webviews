const puppeteer = require('puppeteer-core');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

let wss;
let progressCallbacks = new Map();

/**
 * Initialise le serveur WebSocket pour la communication en temps réel
 * @param {number} port - Port pour le serveur WebSocket
 */
function initWebSocket(port = 3001) {
  wss = new WebSocket.Server({ port });
  
  wss.on('connection', (ws) => {
    console.log('Nouvelle connexion WebSocket établie');
    
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'subscribe' && data.extractionId) {
          // Enregistrer le callback pour cet ID d'extraction
          if (!progressCallbacks.has(data.extractionId)) {
            progressCallbacks.set(data.extractionId, new Set());
          }
          progressCallbacks.get(data.extractionId).add(ws);
        }
      } catch (error) {
        console.error('Erreur de parsing WebSocket:', error);
      }
    });
    
    ws.on('close', () => {
      // Nettoyer les callbacks lors de la déconnexion
      for (const [id, callbacks] of progressCallbacks.entries()) {
        callbacks.delete(ws);
        if (callbacks.size === 0) {
          progressCallbacks.delete(id);
        }
      }
    });
  });

  console.log(`Serveur WebSocket démarré sur le port ${port}`);
  return wss;
}

/**
 * Envoie une mise à jour de progression aux clients WebSocket
 */
function envoyerProgression(extractionId, data) {
  if (!progressCallbacks.has(extractionId)) return;
  
  const message = JSON.stringify({
    type: 'progress',
    extractionId,
    ...data
  });
  
  progressCallbacks.get(extractionId).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

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
    // Configuration de Puppeteer pour Alpine Linux
    const options = {
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
        '--disable-software-rasterizer',
        '--disable-dev-tools'
      ],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: '/usr/bin/chromium-browser',
      ignoreDefaultArgs: ['--disable-extensions']
    };

    // Tentative de lancement du navigateur
    console.log("Tentative de lancement du navigateur...");
    let browser;
    try {
      browser = await puppeteer.launch(options);
    } catch (error) {
      console.error('Erreur lors du premier essai:', error);
      
      // Chemins alternatifs spécifiques à Alpine Linux
      const alpinePaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/lib/chromium/chromium',
        '/usr/lib/chromium-browser/chromium-browser'
      ];

      for (const path of alpinePaths) {
        try {
          console.log(`Tentative avec le chemin: ${path}`);
          options.executablePath = path;
          browser = await puppeteer.launch(options);
          console.log('Navigateur lancé avec succès en utilisant:', path);
          break;
        } catch (e) {
          console.log('Échec avec le chemin:', path);
        }
      }

      if (!browser) {
        console.error('Installation de Chromium nécessaire. Exécutez: apk add chromium');
        throw new Error('Chromium non trouvé. Installez-le avec: apk add chromium');
      }
    }

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
          // Copier le fichier au lieu de le déplacer
          await fsPromises.copyFile(filePath, destinationPath);
          // Supprimer le fichier source après la copie
          await fsPromises.unlink(filePath);

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

/**
 * Lance l'extraction de plusieurs liens Gofile en parallèle ou en séquentiel
 * @param {string[]} urls - Tableau des URLs Gofile à traiter
 * @param {Object} options - Options de configuration
 * @param {boolean} options.parallel - Si true, lance les téléchargements en parallèle, sinon en séquentiel
 * @param {number} options.maxConcurrent - Nombre maximum de téléchargements simultanés (par défaut: 3)
 * @returns {Promise<Array>} - Tableau des résultats de chaque extraction
 */
async function lancerExtractionsMultiples(urls, options = {}) {
  const {
    parallel = false,
    maxConcurrent = 3
  } = options;

  console.log(`Démarrage de l'extraction multiple pour ${urls.length} liens`);
  console.log(`Mode: ${parallel ? 'parallèle' : 'séquentiel'}`);

  const resultats = [];
  const erreurs = [];

  if (parallel) {
    // Traitement par lots pour limiter le nombre de téléchargements simultanés
    for (let i = 0; i < urls.length; i += maxConcurrent) {
      const lot = urls.slice(i, i + maxConcurrent);
      console.log(`Traitement du lot ${i / maxConcurrent + 1} (${lot.length} liens)`);
      
      const promesses = lot.map(async (url) => {
        try {
          const resultat = await lancerExtraction(url);
          resultats.push({ url, success: true, files: resultat });
          console.log(`✓ Extraction réussie pour ${url}`);
        } catch (error) {
          erreurs.push({ url, error: error.message });
          console.error(`✗ Échec de l'extraction pour ${url}:`, error.message);
        }
      });

      await Promise.all(promesses);
    }
  } else {
    // Traitement séquentiel
    for (const url of urls) {
      console.log(`Traitement de ${url}`);
      try {
        const resultat = await lancerExtraction(url);
        resultats.push({ url, success: true, files: resultat });
        console.log(`✓ Extraction réussie pour ${url}`);
      } catch (error) {
        erreurs.push({ url, error: error.message });
        console.error(`✗ Échec de l'extraction pour ${url}:`, error.message);
      }
    }
  }

  // Résumé final
  console.log('\nRésumé des extractions:');
  console.log(`Total: ${urls.length}`);
  console.log(`Réussies: ${resultats.length}`);
  console.log(`Échecs: ${erreurs.length}`);

  if (erreurs.length > 0) {
    console.log('\nDétail des erreurs:');
    erreurs.forEach(({ url, error }) => {
      console.log(`- ${url}: ${error}`);
    });
  }

  return {
    resultats,
    erreurs,
    total: urls.length,
    reussis: resultats.length,
    echecs: erreurs.length
  };
}

// Exporter les fonctions
module.exports = {
  lancerExtraction,
  lancerExtractionsMultiples,
  initWebSocket,
  envoyerProgression
};