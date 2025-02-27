const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Attendre un délai défini (en ms)
 */
const attendre = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Nettoyer le nom du fichier en remplaçant les caractères spéciaux
 */
const sanitizeFilename = filename => filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');

// Constantes pour les extensions de fichiers
const EXTENSIONS_IMAGE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const EXTENSIONS_VIDEO = ['.mp4', '.webm', '.avi', '.mkv', '.mov'];

/**
 * Vérifie si l'extension correspond à une image
 */
const estImage = extension => extension && EXTENSIONS_IMAGE.includes(extension.toLowerCase());

/**
 * Vérifie si l'extension correspond à une vidéo
 */
const estVideo = extension => extension && EXTENSIONS_VIDEO.includes(extension.toLowerCase());

/**
 * Formate correctement l'URL Gofile en fonction de l'entrée utilisateur
 */
function formatGofileUrl(input) {
  // Si l'entrée est déjà une URL complète
  if (input.startsWith('http')) {
    return input;
  }
 
  // Si c'est juste un ID (comme APYNhx)
  if (/^[a-zA-Z0-9]+$/.test(input)) {
    return `https://gofile.io/d/${input}`;
  }
 
  // Si c'est une URL partielle (d/APYNhx)
  if (input.startsWith('d/')) {
    return `https://gofile.io/${input}`;
  }
 
  // En cas de doute, on suppose que c'est un ID
  return `https://gofile.io/d/${input}`;
}

/**
 * Attend que les téléchargements soient terminés en vérifiant le dossier
 */
async function waitForDownload(folder, timeout = 60000) {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkDownload = async () => {
      try {
        const files = await fs.readdir(folder);
        // Vérifier si des fichiers sont en cours de téléchargement (extension .crdownload ou .tmp)
        const downloading = files.some(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
        
        if (!downloading && files.length > 0) {
          // S'assurer que les fichiers ont une taille stable (téléchargement terminé)
          let filesizes = {};
          for (const file of files) {
            if (file === 'image' || file === 'video') continue;
            const filePath = path.join(folder, file);
            try {
              const stats = await fs.stat(filePath);
              if (stats.isFile()) {
                filesizes[file] = stats.size;
              }
            } catch (err) {
              // Ignorer les erreurs de fichiers qui pourraient avoir disparu
            }
          }
          
          // Vérifier à nouveau après 2 secondes pour confirmer que les tailles sont stables
          await attendre(2000);
          let stable = true;
          for (const file of Object.keys(filesizes)) {
            try {
              const filePath = path.join(folder, file);
              const stats = await fs.stat(filePath);
              if (stats.size !== filesizes[file]) {
                stable = false;
                break;
              }
            } catch (err) {
              // Le fichier a pu être déplacé ou supprimé
            }
          }
          
          if (stable) {
            return resolve();
          }
        }
        
        if (Date.now() - startTime > timeout) {
          return reject(new Error("Délai d'attente de téléchargement dépassé"));
        }
        
        // Vérifier à nouveau après un court délai
        setTimeout(checkDownload, 1000);
      } catch (err) {
        reject(err);
      }
    };
    
    // Démarrer la vérification après un court délai initial
    setTimeout(checkDownload, 1000);
  });
}

/**
 * Après téléchargement, déplace et trie les fichiers du dossier de téléchargement
 * dans les sous-dossiers "image" et "video".
 */
async function moveAndSortDownloads(downloadFolder) {
  const imageFolder = path.join(downloadFolder, 'image');
  const videoFolder = path.join(downloadFolder, 'video');

  // Création des dossiers de destination
  await Promise.all([
    fs.mkdir(imageFolder, { recursive: true }),
    fs.mkdir(videoFolder, { recursive: true })
  ]);

  // Lecture des fichiers
  const files = await fs.readdir(downloadFolder);
  const movePromises = [];

  for (const file of files) {
    // On ignore les dossiers de tri déjà existants
    if (file === 'image' || file === 'video') continue;

    const filePath = path.join(downloadFolder, file);
   
    try {
      const stats = await fs.stat(filePath);
     
      if (!stats.isFile()) continue;
     
      const ext = path.extname(file);
      let destination = null;
     
      if (estImage(ext)) {
        destination = path.join(imageFolder, file);
      } else if (estVideo(ext)) {
        destination = path.join(videoFolder, file);
      }

      if (destination) {
        console.log(`Déplacement de ${file} vers ${destination}`);
        movePromises.push(fs.rename(filePath, destination).catch(e => {
          console.warn(`Échec du déplacement de ${file}: ${e.message}. Tentative de copie...`);
          return fs.copyFile(filePath, destination)
            .then(() => fs.unlink(filePath).catch(() => {}));
        }));
      }
    } catch (error) {
      console.error(`Erreur lors du traitement du fichier ${file}:`, error.message);
    }
  }

  // Attendre que tous les déplacements soient terminés
  await Promise.all(movePromises);
}

/**
 * Lance l'extraction en simulant la navigation et déclenche le téléchargement via un clic
 */
async function lancerExtraction(urlGofile, downloadFolder) {
  // Formater l'URL correctement
  const formattedUrl = formatGofileUrl(urlGofile);
  console.log(`Démarrage de l'extraction pour ${formattedUrl}`);

  // Définir le dossier de téléchargement dans le répertoire du projet
  const projectDownloadFolder = path.resolve(__dirname, downloadFolder);
  await fs.mkdir(projectDownloadFolder, { recursive: true });

  // Créer un dossier temporaire unique pour le profil Chrome
  const tmpDir = path.join(os.tmpdir(), `puppeteer_${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });

  let browser = null;
  
  try {
    // Configuration du navigateur avec le dossier temporaire unique
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: tmpDir,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--window-size=1280,800',
        '--disable-dev-shm-usage',
        '--disable-features=site-per-process'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });

    const page = await browser.newPage();

    // Configurer le comportement de téléchargement
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: projectDownloadFolder
    });

    // Paramétrer les en-têtes pour simuler un navigateur réel
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');

    console.log("Navigation vers la page...");
    await page.goto(formattedUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
   
    await attendre(5000);

    // Défilement progressif de la page pour charger tout le contenu
    await page.evaluate(() => {
      return new Promise((resolve) => {
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

    // Rechercher et cliquer sur les boutons de téléchargement
    const buttons = await page.$$('button, a.download-button, [role="button"], a[href*="download"]');
    console.log(`Nombre d'éléments cliquables trouvés : ${buttons.length}`);
   
    let downloadClicked = false;
   
    for (const button of buttons) {
      try {
        const text = await page.evaluate(el => el.textContent || '', button);
        const href = await page.evaluate(el => el.getAttribute('href') || '', button);
       
        if (/download|télécharger/i.test(text) || href.includes('download')) {
          console.log(`Clic sur l'élément avec le texte : ${text.trim()}`);
          await button.click();
          downloadClicked = true;
          await attendre(2000 + Math.random() * 1000);
        }
      } catch (err) {
        console.error("Erreur lors du clic sur un élément :", err.message);
      }
    }
   
    // Si aucun bouton n'a été trouvé, essayons de chercher des boutons spécifiques à Gofile
    if (!downloadClicked) {
      console.log("Recherche de boutons de téléchargement alternatifs...");
     
      try {
        // Cliquer sur les boutons de téléchargement spécifiques à Gofile
        const downloadButtons = await page.$$('button[type="button"]');
        for (const button of downloadButtons) {
          const hasDownloadIcon = await page.evaluate(
            el => el.querySelector('i[class*="download"]') !== null ||
                 el.innerHTML.includes('download') ||
                 el.innerHTML.includes('cloud-download'),
            button
          );
         
          if (hasDownloadIcon) {
            console.log("Bouton de téléchargement alternatif trouvé");
            await button.click();
            await attendre(3000);
          }
        }
      } catch (error) {
        console.error("Erreur lors de la recherche de boutons alternatifs:", error.message);
      }
    }

    console.log("Attente de la fin des téléchargements...");
    
    try {
      // Attendre que les téléchargements soient terminés avec un délai maximum de 2 minutes
      await waitForDownload(projectDownloadFolder, 120000);
    } catch (error) {
      console.warn("Avertissement lors de l'attente des téléchargements:", error.message);
      // On continue même si l'attente a échoué
      await attendre(15000); // Attente de secours
    }
    
  } catch (error) {
    console.error("Erreur durant l'extraction:", error.message);
    throw error;
  } finally {
    // Fermer proprement le navigateur
    if (browser) {
      await browser.close().catch(e => console.warn("Erreur lors de la fermeture du navigateur:", e.message));
    }
    
    // Nettoyer le dossier temporaire
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Impossible de supprimer le dossier temporaire: ${error.message}`);
    }
  }

  // Trier les fichiers téléchargés
  await moveAndSortDownloads(projectDownloadFolder);
  console.log("Opération de téléchargement et de tri terminée.");
}

// Point d'entrée du script
(async () => {
  try {
    // Récupérer l'URL à partir des arguments de la ligne de commande
    const urlArg = process.argv[2];
   
    if (!urlArg) {
      console.error("Erreur : URL non spécifiée. Utilisation : node gofile.js URL_OU_ID");
      console.error("Exemples : ");
      console.error("  node gofile.js https://gofile.io/d/APYNhx");
      console.error("  node gofile.js APYNhx");
      process.exit(1);
    }
   
    const dossierDestination = 'telechargements';
   
    await lancerExtraction(urlArg, dossierDestination);
  } catch (err) {
    console.error("Erreur globale :", err.message);
    process.exit(1);
  }
})();
