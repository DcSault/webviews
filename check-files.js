const fs = require('fs').promises;
const path = require('path');

async function checkDirectoryStructure() {
    const baseDir = __dirname;
    const dirs = {
        data: path.join(baseDir, 'data'),
        media: path.join(baseDir, 'data', 'media'),
        images: path.join(baseDir, 'data', 'media', 'images'),
        videos: path.join(baseDir, 'data', 'media', 'videos'),
        audio: path.join(baseDir, 'data', 'media', 'audio'),
        other: path.join(baseDir, 'data', 'media', 'other'),
        logs: path.join(baseDir, 'logs')
    };

    console.log('=== Vérification de la structure des répertoires ===');
    for (const [name, dir] of Object.entries(dirs)) {
        try {
            const stats = await fs.stat(dir);
            console.log(`✓ ${name}: ${dir} (${stats.isDirectory() ? 'Répertoire' : 'Fichier'})`);
            
            if (stats.isDirectory()) {
                const files = await fs.readdir(dir);
                console.log(`  - Contient ${files.length} fichiers/dossiers`);
                
                if (name === 'media' || ['images', 'videos', 'audio', 'other'].includes(name)) {
                    for (const file of files) {
                        const filePath = path.join(dir, file);
                        const fileStats = await fs.stat(filePath);
                        console.log(`    - ${file} (${fileStats.size} bytes)`);
                    }
                }
            }
        } catch (err) {
            console.log(`✗ ${name}: ${dir} (${err.message})`);
        }
    }

    // Vérifier le fichier metadata.json
    const metadataPath = path.join(dirs.data, 'metadata.json');
    try {
        const metadata = require(metadataPath);
        console.log('\n=== Vérification des métadonnées ===');
        console.log(`Nombre total d'entrées: ${metadata.length}`);
        
        const typeCount = metadata.reduce((acc, item) => {
            acc[item.type] = (acc[item.type] || 0) + 1;
            return acc;
        }, {});
        
        console.log('Distribution par type:');
        Object.entries(typeCount).forEach(([type, count]) => {
            console.log(`- ${type}: ${count} fichiers`);
        });

        // Vérifier la correspondance entre les métadonnées et les fichiers réels
        console.log('\n=== Vérification de la correspondance des fichiers ===');
        for (const item of metadata) {
            const filePath = path.join(dirs.media, `${item.type}s`, item.filename);
            try {
                await fs.access(filePath);
                console.log(`✓ ${item.filename} existe`);
            } catch (err) {
                console.log(`✗ ${item.filename} MANQUANT (${filePath})`);
            }
        }
    } catch (err) {
        console.log(`\n✗ Erreur lors de la lecture des métadonnées: ${err.message}`);
    }
}

// Exécuter la vérification
checkDirectoryStructure().catch(console.error); 