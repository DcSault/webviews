// mediaStore.js
const fs = require('fs').promises;
const path = require('path');

const METADATA_FILE = path.join(__dirname, 'data', 'metadata.json');
const MEDIA_DIR = path.join(__dirname, 'data', 'media');

// Assurer que les répertoires existent
async function ensureDirectories() {
  const dirs = [
    path.join(MEDIA_DIR, 'images'),
    path.join(MEDIA_DIR, 'videos'),
    path.join(MEDIA_DIR, 'audio')
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      console.error(`Erreur lors de la création du répertoire ${dir}:`, err);
    }
  }
  
  // Créer le fichier metadata.json s'il n'existe pas
  try {
    await fs.access(METADATA_FILE);
  } catch (err) {
    await fs.writeFile(METADATA_FILE, JSON.stringify([], null, 2));
  }
}

// Charger les métadonnées
async function getMetadata() {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erreur lors de la lecture des métadonnées:', err);
    return [];
  }
}

// Sauvegarder les métadonnées
async function saveMetadata(metadata) {
  try {
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.error('Erreur lors de l'enregistrement des métadonnées:', err);
  }
}

// Ajouter un nouvel élément média
async function addMediaItem(item) {
  const metadata = await getMetadata();
  
  // Générer un ID unique
  item.id = Date.now().toString();
  item.timestamp = new Date().toISOString();
  
  metadata.push(item);
  await saveMetadata(metadata);
  return item;
}

// Récupérer tous les éléments médias
async function getAllMedia() {
  return await getMetadata();
}

// Récupérer un élément média par son ID
async function getMediaById(id) {
  const metadata = await getMetadata();
  return metadata.find(item => item.id === id);
}

// Obtenir le chemin pour stocker un nouveau fichier
function getMediaFilePath(type, filename) {
  let subdir;
  
  if (type.startsWith('image/')) {
    subdir = 'images';
  } else if (type.startsWith('video/')) {
    subdir = 'videos';
  } else if (type.startsWith('audio/')) {
    subdir = 'audio';
  } else {
    subdir = 'other';
  }
  
  return path.join(MEDIA_DIR, subdir, filename);
}

module.exports = {
  ensureDirectories,
  addMediaItem,
  getAllMedia,
  getMediaById,
  getMediaFilePath
};
