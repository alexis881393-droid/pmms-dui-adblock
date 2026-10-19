/*
 * [LXO] Bloqueur de pubs YouTube pour pmms
 *
 * La page DUI de FiveM a acces au contenu de l'iframe YouTube (pmms s'en sert deja
 * pour les filtres audio). On surveille le lecteur et, pendant une pub :
 *   - le son est coupe,
 *   - la pub est avancee jusqu'a sa fin (et acceleree),
 *   - le bouton "Passer" est clique des qu'il apparait.
 * Les banniere / overlays publicitaires et les elements YouTube parasites sur les
 * ecrans (titre, logo, videos suggerees en fin de video) sont masques par CSS.
 */

/* Diagnostic : affiche en jeu ce que voit le bloqueur (mettre false une fois regle) */
var PMMS_ADBLOCK_DEBUG = true;

function pmmsDebug(media, key, text) {
	if (!PMMS_ADBLOCK_DEBUG) {
		return;
	}

	if (media) {
		if (!media.pmms) {
			media.pmms = {};
		}
		if (!media.pmms.debugSent) {
			media.pmms.debugSent = {};
		}
		if (media.pmms.debugSent[key]) {
			return;
		}
		media.pmms.debugSent[key] = true;
	}

	try {
		sendMessage('notify', {title: 'Bloqueur de pubs', text: text, duration: 8000});
	} catch (e) {}
}

var PMMS_ADBLOCK_CSS = [
	'.ytp-ad-module', '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
	'.ytp-ad-image-overlay', '.ytp-ad-text-overlay', '.ytp-ad-player-overlay',
	'.ytp-ad-player-overlay-layout', '.ytp-ad-preview-container', '.ytp-ad-message-container',
	'.ytp-paid-content-overlay', '.ytp-featured-product', '.video-ads',
	'.ytp-pause-overlay', '.ytp-endscreen-content', '.ytp-ce-element',
	'.ytp-chrome-top', '.ytp-watermark', '.ytp-show-cards-title',
	'.ytp-cards-teaser', '.ytp-impression-link', '.ytp-youtube-button',
	'.ytp-gradient-top', '.ytp-suggested-action', '.iv-branding'
].join(',') + '{display:none !important;visibility:hidden !important;}';

var PMMS_SKIP_SELECTORS = [
	'.ytp-ad-skip-button',
	'.ytp-ad-skip-button-modern',
	'.ytp-skip-ad-button',
	'.ytp-ad-skip-button-slot button',
	'.videoAdUiSkipButton',
	'button[id^="skip-button"]'
].join(',');

function pmmsGetYouTubeDocument(media) {
	var iframe = null;

	try {
		if (media && media.youTubeApi && media.youTubeApi.getIframe) {
			iframe = media.youTubeApi.getIframe();
		}
	} catch (e) {
		return null;
	}

	if (!iframe) {
		return null;
	}

	try {
		var doc = iframe.contentWindow.document;
		/* acces a une propriete pour declencher l'erreur cross-origin si elle existe */
		var test = doc.body;
		return doc;
	} catch (e) {
		pmmsDebug(media, 'noaccess', 'ECHEC : acces au lecteur YouTube refuse (' + (e && e.name ? e.name : e) + ')');
		return null;
	}
}

function pmmsAdBlockTick(media) {
	var doc = pmmsGetYouTubeDocument(media);

	if (!doc) {
		return;
	}

	/* CSS anti-overlays, injecte une seule fois par document */
	if (!doc.getElementById('pmms-adblock-style') && doc.head) {
		var style = doc.createElement('style');
		style.id = 'pmms-adblock-style';
		style.textContent = PMMS_ADBLOCK_CSS;
		doc.head.appendChild(style);
	}

	var ytPlayer = doc.querySelector('.html5-video-player');
	var video = doc.querySelector('video.html5-main-video') || doc.querySelector('video');

	if (!ytPlayer || !video) {
		return;
	}

	pmmsDebug(media, 'access', 'OK : acces au lecteur YouTube');

	if (!video.paused) {
		pmmsDebug(media, 'classes', 'Classes du lecteur : ' + ytPlayer.className.replace(/\s+/g, ' ').substring(0, 300));
	}

	var adShowing = ytPlayer.classList.contains('ad-showing') || ytPlayer.classList.contains('ad-interrupting');

	if (adShowing) {
		if (!media.pmms) {
			media.pmms = {};
		}

		if (!media.pmms.inAd) {
			media.pmms.inAd = true;
			media.pmms.mutedBeforeAd = video.muted;
			pmmsDebug(null, null, 'Pub detectee : son coupe, pub sautee');
		}

		video.muted = true;

		try {
			video.playbackRate = 16;
		} catch (e) {}

		if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
			try {
				video.currentTime = video.duration;
			} catch (e) {}
		}

		var skip = doc.querySelector(PMMS_SKIP_SELECTORS);

		if (skip) {
			skip.click();
		}
	} else if (media.pmms && media.pmms.inAd) {
		/* Fin de la pub : on remet le son et la vitesse normale */
		media.pmms.inAd = false;
		video.muted = media.pmms.mutedBeforeAd || false;

		try {
			video.playbackRate = 1;
		} catch (e) {}
	}
}

function pmmsStartAdBlock(media, id) {
	if (!media) {
		return;
	}

	if (!media.pmms) {
		media.pmms = {};
	}

	if (media.pmms.adBlockTimer) {
		return;
	}

	pmmsDebug(media, 'loaded', 'Bloqueur charge (page ' + location.hostname + ')');

	media.pmms.adBlockTimer = setInterval(function() {
		/* Arret quand le lecteur a ete supprime de la page */
		if (id && !document.getElementById(id)) {
			clearInterval(media.pmms.adBlockTimer);
			return;
		}

		if (!media.youTubeApi) {
			return;
		}

		try {
			pmmsAdBlockTick(media);
		} catch (e) {
			/* ne jamais casser la lecture */
		}
	}, 250);
}
