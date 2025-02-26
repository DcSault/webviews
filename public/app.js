// public/app.js
document.addEventListener('DOMContentLoaded', () => {
  const mediaGrid = document.getElementById('mediaGrid');
  const filterButtons = document.querySelectorAll('.filters button');
  const searchInput = document.getElementById('searchInput');
  let mediaItems = [];

  // Fonction pour charger les médias depuis l'API
  async function loadMedia() {
    try {
      // Afficher un indicateur de chargement
      mediaGrid.innerHTML = '<div class="loading">Chargement des médias...</div>';

      const response = await fetch('/api/media');
      if (!response.ok) {
        throw new Error('Erreur lors du chargement des médias');
      }

      mediaItems = await response.json();
      displayMedia(mediaItems);

      // Mettre à jour le compteur dans le bouton "Tous"
      updateFilterCounts();
    } catch (error) {
      console.error('Erreur:', error);
      mediaGrid.innerHTML = `<div class="error">Erreur lors du chargement des médias: ${error.message}</div>`;
    }
  }

  // Mettre à jour les compteurs dans les boutons de filtre
  function updateFilterCounts() {
    const counts = {
      all: mediaItems.length,
      image: mediaItems.filter(item => item.type === 'image').length,
      video: mediaItems.filter(item => item.type === 'video').length,
      audio: mediaItems.filter(item => item.type === 'audio').length
    };

    filterButtons.forEach(button => {
      const filter = button.dataset.filter;
      const count = counts[filter] || 0;
      const countSpan = button.querySelector('.count') || document.createElement('span');

      if (!button.querySelector('.count')) {
        countSpan.className = 'count';
        button.appendChild(countSpan);
      }

      countSpan.textContent = ` (${count})`;
    });
  }

  // Fonction pour créer un élément média adapté au type
  function createMediaElement(item) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.dataset.type = item.type;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'media-content';

    // Créer l'élément média approprié selon le type
    let mediaElement;

    if (item.type === 'image') {
      mediaElement = document.createElement('img');
      mediaElement.src = `/${item.filePath}`;
      mediaElement.alt = item.description || 'Image';
      mediaElement.loading = 'lazy';

      // Ouvrir l'image en grand au clic
      mediaElement.addEventListener('click', () => {
        window.open(`/${item.filePath}`, '_blank');
      });
    } else if (item.type === 'video') {
      mediaElement = document.createElement('video');
      mediaElement.src = `/${item.filePath}`;
      mediaElement.controls = true;
      mediaElement.preload = 'metadata';

      // Ajouter le comportement de lecture/pause au clic
      contentDiv.addEventListener('click', (e) => {
        if (e.target !== mediaElement) {
          if (mediaElement.paused) {
            mediaElement.play();
          } else {
            mediaElement.pause();
          }
        }
      });
    } else if (item.type === 'audio') {
      const wrapper = document.createElement('div');
      wrapper.className = 'audio-wrapper';

      // Ajouter une image de couverture pour l'audio
      const audioImg = document.createElement('div');
      audioImg.className = 'audio-img';
      audioImg.innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1da1f2" stroke-width="2">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      `;

      mediaElement = document.createElement('audio');
      mediaElement.src = `/${item.filePath}`;
      mediaElement.controls = true;

      wrapper.appendChild(audioImg);
      wrapper.appendChild(mediaElement);
      contentDiv.appendChild(wrapper);
    } else {
      // Pour les autres types de fichiers, afficher une icône générique
      contentDiv.innerHTML = `
        <div class="generic-file">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#1da1f2" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <p>${item.originalName || 'Fichier inconnu'}</p>
        </div>
      `;
    }

    // Ajouter l'élément média à contentDiv sauf pour l'audio et les types génériques
    if (item.type !== 'audio' && item.type !== 'other') {
      contentDiv.appendChild(mediaElement);
    }

    // Informations du média
    const infoDiv = document.createElement('div');
    infoDiv.className = 'media-info';

    const senderName = document.createElement('h3');
    senderName.textContent = item.sender || 'Inconnu';
    senderName.title = item.sender || 'Inconnu';

    const description = document.createElement('p');
    description.textContent = item.description || 'Aucune description';
    description.title = item.description || 'Aucune description';

    const metadata = document.createElement('div');
    metadata.className = 'media-metadata';

    const date = new Date(item.timestamp);
    const formattedDate = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const formattedTime = date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });

    const fileSize = item.size > 1024 * 1024
      ? `${(item.size / (1024 * 1024)).toFixed(1)} Mo`
      : `${(item.size / 1024).toFixed(1)} Ko`;

    metadata.innerHTML = `
      <span title="Date d'ajout">${formattedDate} ${formattedTime}</span>
      <span title="Taille du fichier">${fileSize}</span>
    `;

    // Bouton de téléchargement
    const downloadLink = document.createElement('a');
    downloadLink.href = `/${item.filePath}`;
    downloadLink.download = item.originalName || item.filename;
    downloadLink.className = 'download-btn';
    downloadLink.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;
    downloadLink.title = "Télécharger";

    // Bouton de suppression
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-btn';
    deleteButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18"></path>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;
    deleteButton.title = "Supprimer";
    deleteButton.addEventListener('click', async () => {
      const confirmDelete = confirm('Êtes-vous sûr de vouloir supprimer ce média ?');
      if (confirmDelete) {
        try {
          const response = await fetch(`/api/media/${item.id}`, {
            method: 'DELETE'
          });

          if (response.ok) {
            // Recharger la liste des médias après la suppression
            loadMedia();
          } else {
            alert('Erreur lors de la suppression du média');
          }
        } catch (error) {
          console.error('Erreur:', error);
          alert('Erreur lors de la suppression du média');
        }
      }
    });

    // Ajouter les boutons à la métadonnée
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'media-buttons';
    buttonsDiv.appendChild(downloadLink);
    buttonsDiv.appendChild(deleteButton);

    infoDiv.appendChild(senderName);
    infoDiv.appendChild(description);
    infoDiv.appendChild(metadata);
    infoDiv.appendChild(buttonsDiv);

    card.appendChild(contentDiv);
    card.appendChild(infoDiv);

    return card;
  }

  // Fonction pour afficher les médias dans la grille
  function displayMedia(items) {
    mediaGrid.innerHTML = '';

    if (items.length === 0) {
      mediaGrid.innerHTML = '<div class="no-media">Aucun média trouvé</div>';
      return;
    }

    // Trier par date (plus récent en premier)
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Créer un fragment pour améliorer les performances
    const fragment = document.createDocumentFragment();

    items.forEach(item => {
      const mediaElement = createMediaElement(item);
      fragment.appendChild(mediaElement);
    });

    mediaGrid.appendChild(fragment);
  }

  // Appliquer les filtres et la recherche aux médias
  function applyFiltersAndSearch() {
    const activeFilter = document.querySelector('.filters button.active').dataset.filter;
    const searchTerm = searchInput.value.toLowerCase();

    let filteredItems = mediaItems;

    // Appliquer le filtre de type si ce n'est pas "all"
    if (activeFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.type === activeFilter);
    }

    // Appliquer le terme de recherche s'il y en a un
    if (searchTerm) {
      filteredItems = filteredItems.filter(item => {
        const sender = (item.sender || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        const filename = (item.originalName || '').toLowerCase();

        return sender.includes(searchTerm) ||
               description.includes(searchTerm) ||
               filename.includes(searchTerm);
      });
    }

    displayMedia(filteredItems);
  }

  // Gérer le filtrage des médias
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Mettre à jour les classes actives
      filterButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Appliquer les filtres
      applyFiltersAndSearch();
    });
  });

  // Gérer la recherche
  searchInput.addEventListener('input', () => {
    applyFiltersAndSearch();
  });

  // Ajouter un bouton pour rafraîchir la liste
  const filtersContainer = document.querySelector('.filters');
  const refreshButton = document.createElement('button');
  refreshButton.className = 'refresh-btn';
  refreshButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 4v6h-6"></path>
      <path d="M1 20v-6h6"></path>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
    </svg>
    Rafraîchir
  `;
  filtersContainer.appendChild(refreshButton);

  refreshButton.addEventListener('click', () => {
    loadMedia();
  });

  // Ajouter fonction pour afficher les statistiques
  async function loadAndDisplayStats() {
    try {
      const response = await fetch('/api/stats');
      if (!response.ok) {
        throw new Error('Erreur lors du chargement des statistiques');
      }

      const stats = await response.json();

      // Afficher les statistiques dans le footer
      const footer = document.querySelector('footer');
      const statsDiv = document.createElement('div');
      statsDiv.className = 'stats';

      const totalSize = stats.totalSize > 1024 * 1024 * 1024
        ? `${(stats.totalSize / (1024 * 1024 * 1024)).toFixed(2)} Go`
        : stats.totalSize > 1024 * 1024
          ? `${(stats.totalSize / (1024 * 1024)).toFixed(2)} Mo`
          : `${(stats.totalSize / 1024).toFixed(2)} Ko`;

      statsDiv.innerHTML = `
        <p>
          Total: ${stats.totalCount} fichiers (${totalSize})
          | Images: ${stats.byType.image}
          | Vidéos: ${stats.byType.video}
          | Audio: ${stats.byType.audio}
        </p>
      `;

      // Remplacer les statistiques existantes s'il y en a
      const existingStats = footer.querySelector('.stats');
      if (existingStats) {
        footer.replaceChild(statsDiv, existingStats);
      } else {
        footer.insertBefore(statsDiv, footer.firstChild);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des statistiques:', error);
    }
  }

  // Fonction pour initialiser le mode sombre
  function initDarkMode() {
    const body = document.body;
    const storedTheme = localStorage.getItem('theme');

    // Appliquer le thème stocké ou utiliser la préférence du système
    if (storedTheme) {
      body.classList.toggle('dark-mode', storedTheme === 'dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.toggle('dark-mode', prefersDark);
    }

    // Ajouter le bouton pour changer de thème
    const header = document.querySelector('header');
    const themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.innerHTML = body.classList.contains('dark-mode') ? '☀️' : '🌙';
    themeToggle.title = body.classList.contains('dark-mode') ? 'Passer au mode clair' : 'Passer au mode sombre';
    header.appendChild(themeToggle);

    // Gérer le changement de thème
    themeToggle.addEventListener('click', () => {
      body.classList.toggle('dark-mode');

      // Mettre à jour le bouton
      themeToggle.innerHTML = body.classList.contains('dark-mode') ? '☀️' : '🌙';
      themeToggle.title = body.classList.contains('dark-mode') ? 'Passer au mode clair' : 'Passer au mode sombre';

      // Stocker la préférence
      localStorage.setItem('theme', body.classList.contains('dark-mode') ? 'dark' : 'light');
    });
  }

  // Charger les médias au démarrage
  loadMedia();

  // Charger les statistiques
  loadAndDisplayStats();

  // Initialiser le mode sombre
  initDarkMode();

  // Rafraîchir périodiquement la liste des médias (toutes les 60 secondes)
  setInterval(() => {
    loadMedia();
    loadAndDisplayStats();
  }, 60000);

  // Écouter les changements de visibilité de la page pour recharger les données
  // lorsque l'utilisateur revient sur la page
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadMedia();
      loadAndDisplayStats();
    }
  });

  // Ajouter une fonction pour détecter le scroll et charger plus de médias
  let isLoadingMore = false;
  let currentPage = 1;
  const itemsPerPage = 20;

  window.addEventListener('scroll', () => {
    // Si on est proche du bas de la page et qu'on n'est pas déjà en train de charger
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !isLoadingMore) {
      loadMoreMedia();
    }
  });

  // Fonction pour charger plus de médias
  function loadMoreMedia() {
    const activeFilter = document.querySelector('.filters button.active').dataset.filter;
    const searchTerm = searchInput.value.toLowerCase();

    let filteredItems = mediaItems;

    // Appliquer le filtre de type si ce n'est pas "all"
    if (activeFilter !== 'all') {
      filteredItems = filteredItems.filter(item => item.type === activeFilter);
    }

    // Appliquer le terme de recherche s'il y en a un
    if (searchTerm) {
      filteredItems = filteredItems.filter(item => {
        const sender = (item.sender || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        const filename = (item.originalName || '').toLowerCase();

        return sender.includes(searchTerm) ||
               description.includes(searchTerm) ||
               filename.includes(searchTerm);
      });
    }

    // Calculer les médias à afficher
    const startIndex = currentPage * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;

    // S'il y a encore des médias à charger
    if (startIndex < filteredItems.length) {
      isLoadingMore = true;

      // Récupérer les éléments pour cette page
      const itemsToAdd = filteredItems.slice(startIndex, endIndex);

      // Ajouter les éléments à la grille
      const fragment = document.createDocumentFragment();
      itemsToAdd.forEach(item => {
        const mediaElement = createMediaElement(item);
        fragment.appendChild(mediaElement);
      });

      mediaGrid.appendChild(fragment);

      // Mettre à jour la page actuelle
      currentPage++;
      isLoadingMore = false;
    }
  }
});