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
	try {
		if (media && media.youTubeApi && media.youTubeApi.getIframe) {
			var iframe = media.youTubeApi.getIframe();

			if (iframe && iframe.contentWindow) {
				return iframe.contentWindow.document;
			}
		}
	} catch (e) {
		/* iframe pas encore prete */
	}

	return null;
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

	var adShowing = ytPlayer.classList.contains('ad-showing') || ytPlayer.classList.contains('ad-interrupting');

	if (adShowing) {
		if (!media.pmms) {
			media.pmms = {};
		}

		if (!media.pmms.inAd) {
			media.pmms.inAd = true;
			media.pmms.mutedBeforeAd = video.muted;
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
