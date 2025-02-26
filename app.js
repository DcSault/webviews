// Importations des modules nécessaires
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Configuration de l'application
const app = express();
const port = process.env.PORT || 3000;

// Création des répertoires nécessaires
const dataDir = path.join(__dirname, 'data');
const mediaDir = path.join(dataDir, 'media');
const imagesDir = path.join(mediaDir, 'images');
const videosDir = path.join(mediaDir, 'videos');
const audioDir = path.join(mediaDir, 'audio');
const otherDir = path.join(mediaDir, 'other');
const logsDir = path.join(__dirname, 'logs');
const metadataPath = path.join(dataDir, 'metadata.json');

// Vérification et création des répertoires
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
}

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

if (!fs.existsSync(otherDir)) {
  fs.mkdirSync(otherDir, { recursive: true });
}

// Configuration des logs
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);

// Middleware pour analyser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: accessLogStream }));

// Servir les fichiers statiques
app.use(express.static('public'));
app.use('/data/media', express.static(mediaDir));

// Configuration de Multer pour l'upload des fichiers
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Déterminer le dossier de destination en fonction du type de fichier
    const mimeType = file.mimetype;
    let destinationDir = otherDir;

    if (mimeType.startsWith('image/')) {
      destinationDir = imagesDir;
    } else if (mimeType.startsWith('video/')) {
      destinationDir = videosDir;
    } else if (mimeType.startsWith('audio/')) {
      destinationDir = audioDir;
    }

    cb(null, destinationDir);
  },
  filename: function (req, file, cb) {
    // Générer un nom de fichier unique
    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    cb(null, fileName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limite de taille
  },
  fileFilter: function (req, file, cb) {
    // Accepter tous les types de fichiers mais on pourrait mettre des restrictions ici
    cb(null, true);
  }
});

// Fonction pour obtenir les métadonnées des médias
async function getMetadata() {
  try {
    if (!fs.existsSync(metadataPath)) {
      return [];
    }
    const data = fs.readFileSync(metadataPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erreur lors de la lecture des métadonnées:', err);
    return [];
  }
}

// Fonction pour sauvegarder les métadonnées
async function saveMetadata(metadata) {
  try {
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  } catch (err) {
    console.error('Erreur lors de la sauvegarde des métadonnées:', err);
    throw err;
  }
}

// Route pour récupérer tous les médias
app.get('/api/media', async (req, res) => {
  try {
    const metadata = await getMetadata();
    res.json(metadata);
  } catch (err) {
    console.error('Erreur lors de la récupération des médias:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour récupérer un média spécifique par ID
app.get('/api/media/:id', async (req, res) => {
  try {
    const mediaId = req.params.id;
    const metadata = await getMetadata();
    const media = metadata.find(item => item.id === mediaId);
    
    if (!media) {
      return res.status(404).json({ error: 'Média non trouvé' });
    }
    
    res.json(media);
  } catch (err) {
    console.error('Erreur lors de la récupération du média:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour récupérer les statistiques des médias
app.get('/api/stats', async (req, res) => {
  try {
    const metadata = await getMetadata();
    
    const stats = {
      totalCount: metadata.length,
      totalSize: metadata.reduce((total, item) => total + (item.size || 0), 0),
      byType: {
        image: metadata.filter(item => item.type === 'image').length,
        video: metadata.filter(item => item.type === 'video').length,
        audio: metadata.filter(item => item.type === 'audio').length,
        other: metadata.filter(item => item.type === 'other').length
      }
    };
    
    res.json(stats);
  } catch (err) {
    console.error('Erreur lors de la récupération des statistiques:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour l'upload de médias
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files;
    const { sender, description } = req.body;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier envoyé' });
    }
    
    // Récupérer les métadonnées existantes
    let metadata = await getMetadata();
    
    // Ajouter les métadonnées pour chaque fichier
    const newFiles = files.map(file => {
      // Déterminer le type de média
      let type = 'other';
      if (file.mimetype.startsWith('image/')) {
        type = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        type = 'video';
      } else if (file.mimetype.startsWith('audio/')) {
        type = 'audio';
      }
      
      // Créer le chemin relatif pour le fichier
      const relPath = path.join('data', 'media', type === 'image' ? 'images' : 
                                              type === 'video' ? 'videos' : 
                                              type === 'audio' ? 'audio' : 'other', 
                                file.filename);
      
      // Remplacer les backslashes par des slashes pour les URLs
      const filePath = relPath.replace(/\\/g, '/');
      
      return {
        id: uuidv4(),
        type,
        sender,
        description,
        originalName: file.originalname,
        filename: file.filename,
        filePath,
        mediaType: file.mimetype,
        size: file.size,
        timestamp: new Date().toISOString()
      };
    });
    
    // Ajouter les nouveaux fichiers à la métadonnée
    metadata = [...metadata, ...newFiles];
    
    // Sauvegarder les métadonnées
    await saveMetadata(metadata);
    
    res.status(201).json({
      message: `${files.length} fichier(s) uploadé(s) avec succès`,
      files: newFiles
    });
  } catch (err) {
    console.error('Erreur lors de l\'upload des fichiers:', err);
    res.status(500).json({ error: 'Erreur lors de l\'upload des fichiers' });
  }
});

// Route pour supprimer un média
app.delete('/api/media/:id', async (req, res) => {
  try {
    const mediaId = req.params.id;
    let metadata = await getMetadata();
    
    // Trouver le média à supprimer
    const mediaToDelete = metadata.find(item => item.id === mediaId);
    
    if (!mediaToDelete) {
      return res.status(404).json({ error: 'Média non trouvé' });
    }
    
    // Supprimer le fichier physique
    const filePath = path.join(__dirname, mediaToDelete.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Mettre à jour les métadonnées
    metadata = metadata.filter(item => item.id !== mediaId);
    await saveMetadata(metadata);
    
    res.json({ message: 'Média supprimé avec succès' });
  } catch (err) {
    console.error('Erreur lors de la suppression du média:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour exporter les métadonnées
app.get('/api/export', async (req, res) => {
  try {
    const metadata = await getMetadata();
    
    // Formater les données pour l'export
    const exportData = {
      exported_at: new Date().toISOString(),
      media_count: metadata.length,
      media: metadata.map(item => ({
        id: item.id,
        type: item.type,
        sender: item.sender,
        description: item.description,
        filename: item.originalName || item.filename,
        size: item.size,
        date_added: item.timestamp,
        path: item.filePath
      }))
    };
    
    // Définir les en-têtes pour le téléchargement
    res.setHeader('Content-Disposition', 'attachment; filename=media-export.json');
    res.setHeader('Content-Type', 'application/json');
    
    // Envoyer les données formatées
    res.json(exportData);
  } catch (err) {
    console.error('Erreur lors de l\'export:', err);
    res.status(500).json({ error: 'Erreur lors de l\'export des données' });
  }
});

// Route pour importer des médias depuis un fichier d'export
app.post('/api/import', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const importData = req.body;
    
    if (!importData || !importData.media || !Array.isArray(importData.media)) {
      return res.status(400).json({ error: 'Format d\'import invalide' });
    }
    
    // Récupérer les métadonnées existantes
    let metadata = await getMetadata();
    const existingIds = new Set(metadata.map(item => item.id));
    
    // Filtrer les entrées déjà existantes et ajouter uniquement les nouvelles
    const newEntries = importData.media.filter(item => {
      // Vérifier si l'ID existe déjà
      if (existingIds.has(item.id)) {
        return false;
      }
      
      // Vérifier si le fichier existe physiquement
      const filePath = path.join(__dirname, item.path);
      return fs.existsSync(filePath);
    });
    
    if (newEntries.length === 0) {
      return res.json({ message: 'Aucune nouvelle entrée à importer' });
    }
    
    // Formater correctement les nouvelles entrées
    const formattedEntries = newEntries.map(item => ({
      id: item.id,
      type: item.type,
      sender: item.sender,
      description: item.description,
      originalName: item.filename,
      filename: path.basename(item.path),
      filePath: item.path,
      size: item.size,
      timestamp: item.date_added || new Date().toISOString()
    }));
    
    // Ajouter les nouvelles entrées
    metadata = [...metadata, ...formattedEntries];
    
    // Sauvegarder les métadonnées
    await saveMetadata(metadata);
    
    res.json({ 
      message: `${formattedEntries.length} média(s) importé(s) avec succès`,
      imported: formattedEntries.length
    });
  } catch (err) {
    console.error('Erreur lors de l\'import:', err);
    res.status(500).json({ error: 'Erreur lors de l\'import des données' });
  }
});

// Rediriger toutes les autres routes vers l'application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});
