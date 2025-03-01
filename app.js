// Importations des modules nécessaires
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const morgan = require('morgan');
const session = require('express-session'); // Pour la gestion des sessions
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { lancerExtraction } = require('./gofile_debrid');
const compression = require('compression');
const cache = require('memory-cache');

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

// Ajouter la compression
app.use(compression());

// Création des répertoires nécessaires
const dataDir = '/app/data';  // Chemin dans le conteneur Docker
const mediaDir = path.join(dataDir, 'media');
const imagesDir = path.join(mediaDir, 'images');
const videosDir = path.join(mediaDir, 'videos');
const audioDir = path.join(mediaDir, 'audio');
const otherDir = path.join(mediaDir, 'other');
const logsDir = '/app/logs';  // Chemin dans le conteneur Docker
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

// Middleware de mise en cache pour les médias
const cacheMiddleware = (duration) => {
    return (req, res, next) => {
        const key = '__express__' + req.originalUrl || req.url;
        const cachedBody = cache.get(key);
        
        if (cachedBody) {
            res.send(cachedBody);
            return;
        } else {
            res.sendResponse = res.send;
            res.send = (body) => {
                cache.put(key, body, duration * 1000);
                res.sendResponse(body);
            };
            next();
        }
    };
};

// Route optimisée pour récupérer les médias
app.get('/api/media', cacheMiddleware(300), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filter = req.query.filter || 'all';
        const search = req.query.search?.toLowerCase() || '';
        
        let metadata = await getMetadata();
        console.log('Métadonnées chargées:', metadata.length, 'entrées');

        // Appliquer les filtres
        if (filter !== 'all') {
            metadata = metadata.filter(item => item.type === filter);
            console.log('Après filtre:', metadata.length, 'entrées');
        }

        // Appliquer la recherche
        if (search) {
            metadata = metadata.filter(item => 
                item.originalName.toLowerCase().includes(search) ||
                (item.description && item.description.toLowerCase().includes(search)) ||
                (item.sender && item.sender.toLowerCase().includes(search))
            );
            console.log('Après recherche:', metadata.length, 'entrées');
        }

        // Trier par date de création (du plus récent au plus ancien)
        metadata.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Calculer la pagination
        const totalItems = metadata.length;
        const totalPages = Math.ceil(totalItems / limit);
        const skip = (page - 1) * limit;
        const paginatedData = metadata.slice(skip, skip + limit);

        // Vérifier l'existence des fichiers
        const validatedData = await Promise.all(paginatedData.map(async (item) => {
            const filePath = path.join('/app/data/media', `${item.type}s`, item.filename);
            console.log('Vérification du fichier:', filePath);
            try {
                await fs.promises.access(filePath, fs.constants.F_OK);
                console.log('✓ Fichier trouvé:', filePath);
                return {
                    ...item,
                    filePath: `/data/media/${item.type}s/${item.filename}`
                };
            } catch (err) {
                console.warn(`✗ Fichier non trouvé: ${filePath}`);
                return null;
            }
        }));

        // Filtrer les fichiers non existants
        const finalData = validatedData.filter(item => item !== null);
        console.log('Nombre de fichiers valides:', finalData.length);
        
        res.json({
            data: finalData,
            total: totalItems,
            page,
            totalPages,
            hasMore: page < totalPages
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des médias:', error);
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

// Optimisation de la gestion des fichiers statiques
app.use('/data/media', (req, res, next) => {
    // Ajout des headers CORS pour permettre l'accès aux médias
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Cache et compression
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    express.static(mediaDir, {
        maxAge: '1y',
        etag: true,
        lastModified: true
    })(req, res, next);
});

// Route pour les statistiques du dashboard
app.get('/api/stats', async (req, res) => {
  try {
    // Récupération des fichiers
    const files = await Media.find();
    
    // Statistiques générales
    const totalFiles = files.length;
    const totalStorage = files.reduce((acc, file) => acc + file.size, 0);
    const todayFiles = files.filter(file => {
      const today = new Date();
      const fileDate = new Date(file.createdAt);
      return fileDate.toDateString() === today.toDateString();
    }).length;
    
    // Distribution des types de fichiers
    const fileTypes = {
      images: files.filter(f => f.type === 'image').length,
      videos: files.filter(f => f.type === 'video').length,
      audio: files.filter(f => f.type === 'audio').length,
      others: files.filter(f => !['image', 'video', 'audio'].includes(f.type)).length
    };

    // Activité d'upload sur 30 jours
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const uploadActivity = {
      dates: [],
      counts: []
    };

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const count = files.filter(file => {
        const fileDate = new Date(file.createdAt);
        return fileDate.toDateString() === date.toDateString();
      }).length;
      
      uploadActivity.dates.unshift(date.toLocaleDateString());
      uploadActivity.counts.unshift(count);
    }

    // Historique du stockage
    const storageHistory = {
      dates: uploadActivity.dates,
      values: uploadActivity.counts.map((count, index) => {
        return files
          .filter(file => new Date(file.createdAt) <= new Date(thirtyDaysAgo.getTime() + (index * 24 * 60 * 60 * 1000)))
          .reduce((acc, file) => acc + file.size, 0);
      })
    };

    // Activité récente
    const recentActivity = files
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(file => ({
        type: 'upload',
        description: `${file.originalName} (${formatSize(file.size)})`,
        timestamp: file.createdAt
      }));

    // Réponse
    res.json({
      totalFiles,
      totalStorage,
      todayFiles,
      activeUsers: Math.floor(Math.random() * 10) + 1, // Simulé pour l'exemple
      storageLimit: 100 * 1024 * 1024 * 1024, // 100 GB
      fileTypes,
      uploadActivity,
      storageHistory,
      recentActivity
    });

  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

// Fonction utilitaire pour formater la taille des fichiers
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
});