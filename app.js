// Importations des modules nécessaires
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const morgan = require('morgan');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
require('dotenv').config();

// Configuration de l'application
const app = express();
const port = process.env.PORT || 3000;

// Création des dossiers nécessaires
const logsDir = path.join(__dirname, 'logs');
const mediaDir = path.join(__dirname, 'data', 'media');
const videosDir = path.join(mediaDir, 'videos');
const imagesDir = path.join(mediaDir, 'images');
const otherDir = path.join(mediaDir, 'other');

// Créer les dossiers s'ils n'existent pas
[logsDir, mediaDir, videosDir, imagesDir, otherDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configuration des logs
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);

// Augmenter les limites globales d'Express
app.use(express.json({limit: '10240mb'}));
app.use(express.urlencoded({extended: true, limit: '10240mb'}));

// Configuration de la session
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-key-should-be-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Middleware pour analyser les requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: accessLogStream }));

// Middleware d'authentification
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// Chemin vers le fichier de métadonnées
const metadataPath = path.join(__dirname, 'data', 'metadata.json');

// Configuration de Multer pour l'upload des fichiers
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const mimeType = file.mimetype;
    let destinationDir = otherDir;

    if (mimeType.startsWith('image/')) {
      destinationDir = imagesDir;
    } else if (mimeType.startsWith('video/')) {
      destinationDir = videosDir;
    }

    cb(null, destinationDir);
  },
  filename: function (req, file, cb) {
    // Générer un nom unique avec l'extension originale
    const originalExt = path.extname(file.originalname);
    const uniqueFilename = uuidv4() + originalExt;
    cb(null, uniqueFilename);
  }
});

// Middleware Multer avec configuration
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10240 * 1024 * 1024 // 10 GB (en octets)
  }
});

// Route de login
app.post('/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  
  // Vérifier les identifiants (à remplacer par une vérification plus sécurisée)
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, redirect: '/' });
  } else {
    res.status(401).json({ success: false, message: 'Identifiants incorrects' });
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

// Servir les fichiers statiques
app.use(express.static('public'));
app.use('/data/media', express.static(mediaDir));

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
app.post('/api/upload', requireAuth, upload.array('files', 100), async (req, res) => {
  try {
    const files = req.files;
    const { sender, description } = req.body;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier uploadé' });
    }
    
    const metadata = await getMetadata();
    
    const newFiles = files.map(file => {
      const fileType = file.mimetype.startsWith('image/') ? 'image' : 
                     file.mimetype.startsWith('video/') ? 'video' : 'other';
      
      // Créer le chemin relatif pour accéder au fichier via le navigateur
      const relativePath = `/data/media/${fileType}s/${file.filename}`;
      
      const newFile = {
        id: uuidv4(),
        name: file.originalname,
        path: relativePath,
        type: fileType,
        size: file.size,
        uploadDate: new Date().toISOString(),
        sender: sender || 'Anonymous',
        description: description || '',
      };
      
      metadata.push(newFile);
      return newFile;
    });
    
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
app.delete('/api/media/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    let metadata = await getMetadata();
    
    const fileToDelete = metadata.find(item => item.id === id);
    if (!fileToDelete) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    
    // Supprimer le fichier physique
    const filePath = path.join(__dirname, fileToDelete.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Mettre à jour les métadonnées
    metadata = metadata.filter(item => item.id !== id);
    await saveMetadata(metadata);
    
    res.json({ message: 'Fichier supprimé avec succès' });
  } catch (err) {
    console.error('Erreur lors de la suppression du fichier :', err);
    res.status(500).json({ error: 'Erreur lors de la suppression du fichier' });
  }
});

// Route pour exécuter gofile.js
app.post('/api/gofile-download', requireAuth, (req, res) => {
  const gofileUrl = req.body.url;
  
  if (!gofileUrl) {
    return res.status(400).json({ success: false, message: 'URL Gofile manquante' });
  }
  
  // Chemin vers le script gofile.js
  const scriptPath = path.join(__dirname, 'gofile.js');
  
  // Lancer le script avec l'URL comme argument
  const command = `node "${scriptPath}" "${gofileUrl}"`;
  
  console.log(`Exécution de la commande: ${command}`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erreur d'exécution: ${error.message}`);
      return res.status(500).json({ 
        success: false, 
        message: 'Erreur lors du téléchargement', 
        error: error.message,
        details: stderr
      });
    }
    
    if (stderr) {
      console.warn(`Avertissements: ${stderr}`);
    }
    
    console.log(`Sortie: ${stdout}`);
    
    // Après le téléchargement, on ajoute les fichiers téléchargés aux métadonnées
    const updateMetadata = async () => {
      try {
        // Attendre un peu pour s'assurer que les fichiers sont bien déplacés
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const metadata = await getMetadata();
        const newFiles = [];
        
        // Parcourir les dossiers d'images et de vidéos pour trouver les nouveaux fichiers
        const scanDirectory = async (directory, type) => {
          const files = fs.readdirSync(directory);
          
          for (const filename of files) {
            const filePath = path.join(directory, filename);
            const stats = fs.statSync(filePath);
            
            if (stats.isFile()) {
              // Vérifier si le fichier existe déjà dans les métadonnées
              const relativePath = `/data/media/${type}s/${filename}`;
              const existingFile = metadata.find(item => item.path === relativePath);
              
              if (!existingFile) {
                const newFile = {
                  id: uuidv4(),
                  name: filename,
                  path: relativePath,
                  type: type,
                  size: stats.size,
                  uploadDate: new Date().toISOString(),
                  sender: 'Gofile Downloader',
                  description: `Téléchargé depuis Gofile: ${gofileUrl}`,
                };
                
                newFiles.push(newFile);
                metadata.push(newFile);
              }
            }
          }
        };
        
        await scanDirectory(imagesDir, 'image');
        await scanDirectory(videosDir, 'video');
        
        if (newFiles.length > 0) {
          await saveMetadata(metadata);
          console.log(`${newFiles.length} nouveaux fichiers ajoutés aux métadonnées`);
        }
      } catch (err) {
        console.error('Erreur lors de la mise à jour des métadonnées :', err);
      }
    };
    
    // Lancer la mise à jour des métadonnées en arrière-plan
    updateMetadata();
    
    return res.json({ 
      success: true, 
      message: 'Téléchargement terminé avec succès',
      output: stdout
    });
  });
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});
