// Importations des modules nécessaires
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const morgan = require('morgan');
const session = require('express-session'); // Pour la gestion des sessions
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { lancerExtraction, lancerExtractionsMultiples, initWebSocket } = require('./gofile_debrid');

// Configuration de l'application
const app = express();
const port = process.env.PORT || 3000;

// Augmenter les limites globales d'Express
app.use(express.json({limit: '10240mb'}));
app.use(express.urlencoded({extended: true, limit: '10240mb'}));

// Augmenter le timeout
app.use((req, res, next) => {
    res.setTimeout(3600000); // 1 heure
    next();
});

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

// Configuration de la session
app.use(session({
    secret: process.env.SESSION_SECRET || 'votre_secret_session', // Utilisez une clé secrète forte
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // À mettre à true en production avec HTTPS
}));

// Middleware d'authentification
const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Route de login
app.post('/login', express.json(), (req, res) => {
    const { username, password } = req.body;

    // Vérification des identifiants
    if (username === 'admin' && password === 'wdTskYGraa42hEx3aUsE') {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Identifiants incorrects' 
        });
    }
});

// Route de logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erreur lors de la déconnexion :', err);
            res.status(500).send('Erreur lors de la déconnexion');
        } else {
            res.redirect('/login');
        }
    });
});

// Route pour servir la page de login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protéger les routes principales
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/upload.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/gofile.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'gofile.html'));
});

// Servir les fichiers statiques
app.use(express.static('public'));
app.use('/data/media', express.static(mediaDir));

// Configuration de Multer pour l'upload des fichiers
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
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
        const fileExt = path.extname(file.originalname);
        const fileName = `${uuidv4()}${fileExt}`;
        cb(null, fileName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 * 1024, // 10GB limite de taille
        files: 100 // Nombre maximum de fichiers
    },
    fileFilter: function (req, file, cb) {
        // Accepter tous les types de fichiers
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
        console.error('Erreur lors de la lecture des métadonnées :', err);
        return [];
    }
}

// Fonction pour sauvegarder les métadonnées
async function saveMetadata(metadata) {
    try {
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    } catch (err) {
        console.error('Erreur lors de la sauvegarde des métadonnées :', err);
        throw err;
    }
}

// Route pour récupérer tous les médias
app.get('/api/media', async (req, res) => {
    try {
        const metadata = await getMetadata();
        res.json(metadata);
    } catch (err) {
        console.error('Erreur lors de la récupération des médias :', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour l'upload de médias
app.post('/api/upload', upload.array('files', 100), async (req, res) => {
    try {
        const files = req.files;
        const { sender, description } = req.body;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Aucun fichier envoyé' });
        }

        let metadata = await getMetadata();

        const newFiles = files.map(file => {
            let type = 'other';
            if (file.mimetype.startsWith('image/')) {
                type = 'image';
            } else if (file.mimetype.startsWith('video/')) {
                type = 'video';
            } else if (file.mimetype.startsWith('audio/')) {
                type = 'audio';
            }

            const relPath = path.join('data', 'media', type === 'image' ? 'images' : 
                                                  type === 'video' ? 'videos' : 
                                                  type === 'audio' ? 'audio' : 'other', 
                                    file.filename);

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

        metadata = [...metadata, ...newFiles];
        await saveMetadata(metadata);

        res.status(201).json({
            message: `${files.length} fichier(s) uploadé(s) avec succès`,
            files: newFiles
        });
    } catch (err) {
        console.error('Erreur lors de l\'upload des fichiers :', err);
        res.status(500).json({ error: 'Erreur lors de l\'upload des fichiers' });
    }
});

// Route pour supprimer un média
app.delete('/api/media/:id', async (req, res) => {
    try {
        const mediaId = req.params.id;
        const metadata = await getMetadata();

        // Trouver le média à supprimer
        const mediaIndex = metadata.findIndex(item => item.id === mediaId);
        if (mediaIndex === -1) {
            return res.status(404).json({ error: 'Média non trouvé' });
        }

        // Supprimer le fichier physique du serveur
        const mediaToDelete = metadata[mediaIndex];
        const filePath = path.join(__dirname, mediaToDelete.filePath);

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath); // Supprimer le fichier
        } else {
            console.warn(`Fichier non trouvé : ${filePath}`);
        }

        // Supprimer le média des métadonnées
        metadata.splice(mediaIndex, 1);
        await saveMetadata(metadata);

        res.status(200).json({ message: 'Média supprimé avec succès' });
    } catch (err) {
        console.error('Erreur lors de la suppression du média :', err);
        res.status(500).json({ error: 'Erreur lors de la suppression du média' });
    }
});

// Route pour l'extraction Gofile
app.post('/api/gofile/extract', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL Gofile requise' });
        }

        // Lancer l'extraction en arrière-plan
        const downloadFolder = path.join(mediaDir, 'gofile_downloads');
        
        // Créer une promesse pour gérer l'extraction et la mise à jour des métadonnées
        const extractionPromise = lancerExtraction(url, downloadFolder)
            .then(async (downloadedFiles) => {
                if (downloadedFiles && downloadedFiles.length > 0) {
                    // Mettre à jour les métadonnées
                    const metadata = await getMetadata();
                    metadata.push(...downloadedFiles);
                    await saveMetadata(metadata);
                    return downloadedFiles.length;
                }
                return 0;
            })
            .catch(err => {
                console.error('Erreur lors de l\'extraction Gofile :', err);
                throw err;
            });

        // Répondre immédiatement à la requête
        res.status(202).json({ 
            message: 'Extraction Gofile démarrée. Les fichiers seront disponibles une fois le téléchargement terminé.',
            downloadFolder
        });

        // Gérer l'extraction en arrière-plan
        extractionPromise.then(fileCount => {
            console.log(`Extraction terminée : ${fileCount} fichier(s) traité(s)`);
        }).catch(err => {
            console.error('Erreur pendant l\'extraction :', err);
        });

    } catch (err) {
        console.error('Erreur lors du traitement de la requête Gofile :', err);
        res.status(500).json({ error: 'Erreur lors du traitement de la requête Gofile' });
    }
});

// Initialiser le WebSocket sur le port 3001
initWebSocket(3001);

// Route pour l'extraction multiple de Gofile
app.post('/api/extract', async (req, res) => {
  const { urls, parallel } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs invalides' });
  }

  try {
    // Lancer l'extraction en arrière-plan
    const options = {
      parallel: parallel || false,
      maxConcurrent: 3
    };

    // Ne pas attendre la fin de l'extraction pour répondre
    lancerExtractionsMultiples(urls, options)
      .catch(error => console.error('Erreur lors de l\'extraction multiple:', error));

    // Répondre immédiatement avec les IDs des extractions
    const extractionIds = urls.map(() => uuidv4());
    res.json({ 
      message: 'Extractions démarrées',
      extractionIds
    });
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ error: 'Erreur lors du démarrage des extractions' });
  }
});

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
});