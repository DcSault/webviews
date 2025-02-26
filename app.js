// Importations des modules nécessaires
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const morgan = require('morgan');
const session = require('express-session'); // Pour la gestion des sessions
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

// Configuration de la session
app.use(session({
    secret: 'votre_secret_session', // Changez ceci par une clé secrète forte
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
    if (username === 'admin' && password === '2404') {
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
        fileSize: 50 * 1024 * 1024 // 50MB limite de taille
    },
    fileFilter: function (req, file, cb) {
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
app.post('/api/upload', upload.array('files', 10), async (req, res) => {
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

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
});