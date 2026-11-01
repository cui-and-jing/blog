/** On-demand image lightbox for rendered Markdown prose. Pages without images do not download it. */
export function setupLightbox(): void {
      const lightboxImages = Array.from(document.querySelectorAll<HTMLImageElement>('.prose img'));
      const lightbox = document.getElementById('lightbox') as HTMLDialogElement | null;

      if (lightbox && lightboxImages.length > 0) {
        const view = document.getElementById('lightbox-img') as HTMLImageElement;
        const stage = document.getElementById('lightbox-stage') as HTMLElement;
        const caption = document.getElementById('lightbox-caption');
        const zoomLabel = document.getElementById('lightbox-zoom');
        const origin = document.getElementById('lightbox-origin') as HTMLAnchorElement | null;
        const hint = document.getElementById('lightbox-hint');
        const prev = lightbox.querySelector<HTMLButtonElement>('.lightbox-nav.prev');
        const next = lightbox.querySelector<HTMLButtonElement>('.lightbox-nav.next');
        let index = 0;

        /* zoom 是倍率，tx / ty 是相对舞台中心的平移量 */
        let zoom = 1;
        let tx = 0;
        let ty = 0;
        let hintTimer = 0;

        const clamp = () => {
          const w = view.offsetWidth;
          const h = view.offsetHeight;
          const maxX = Math.max(0, (w * (zoom - 1)) / 2);
          const maxY = Math.max(0, (h * (zoom - 1)) / 2);
          tx = Math.max(-maxX, Math.min(maxX, tx));
          ty = Math.max(-maxY, Math.min(maxY, ty));
        };

        const paint = () => {
          view.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
          stage.classList.toggle('is-zoomed', zoom > 1);
          if (zoomLabel) {
            zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
            zoomLabel.hidden = zoom <= 1;
          }
        };

        const reset = () => {
          zoom = 1;
          tx = 0;
          ty = 0;
          paint();
        };

        /* 让指针下的那一点在缩放前后保持不动，而不是永远从中心放大 */
        const zoomAt = (target: number, px: number, py: number) => {
          const nextZoom = Math.max(1, Math.min(4, target));
          if (nextZoom === zoom) return;
          const ratio = nextZoom / zoom;
          tx = px - (px - tx) * ratio;
          ty = py - (py - ty) * ratio;
          zoom = nextZoom;
          if (zoom === 1) {
            tx = 0;
            ty = 0;
          }
          clamp();
          paint();
        };

        const pointerAt = (event: MouseEvent) => {
          const rect = stage.getBoundingClientRect();
          return {
            x: event.clientX - (rect.left + rect.width / 2),
            y: event.clientY - (rect.top + rect.height / 2),
          };
        };

        const flashHint = () => {
          if (!hint) return;
          window.clearTimeout(hintTimer);
          hint.classList.add('is-on');
          hintTimer = window.setTimeout(() => hint.classList.remove('is-on'), 2600);
        };

        if (lightboxImages.length < 2) {
          prev?.setAttribute('hidden', '');
          next?.setAttribute('hidden', '');
        }

        const show = (i: number) => {
          index = (i + lightboxImages.length) % lightboxImages.length;
          const image = lightboxImages[index];
          /* 先把固有尺寸占上：图没到之前舞台高度是 0，滚轮和拖动都无处可落 */
          if (image.naturalWidth && image.naturalHeight) {
            view.width = image.naturalWidth;
            view.height = image.naturalHeight;
          }
          view.src = image.currentSrc || image.src;
          view.alt = image.alt;
          /* 「原图」指向 img 的 src 而不是 currentSrc：后者是 srcset 选中的档位，放大后会糊 */
          if (origin) origin.href = image.src;
          if (caption) {
            /* 有图注就显示图注，没有才退回 alt */
            const figCaption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
            const text = figCaption || image.alt || '';
            caption.textContent = text;
            caption.hidden = !text;
          }
          reset();
        };

        const openLightbox = (i: number) => {
          show(i);
          lightbox.showModal();
          document.documentElement.style.overflow = 'hidden';
          flashHint();
        };

        /* Keep image semantics per node, but only two event listeners per page,
           rather than one click/keyboard closure per image on long articles. */
        for (const image of lightboxImages) {
          image.loading = 'lazy';
          image.decoding = 'async';
          image.tabIndex = 0;
          image.setAttribute('role', 'button');
          image.setAttribute('aria-label', `放大图片：${image.alt || '正文图片'}`);
        }

        const activateImage = (event: MouseEvent | KeyboardEvent) => {
          const i = lightboxImages.indexOf(event.target as HTMLImageElement);
          if (i < 0) return;
          if (event instanceof KeyboardEvent) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
          }
          openLightbox(i);
        };
        document.addEventListener('click', activateImage);
        document.addEventListener('keydown', activateImage);

        /* 缩放：滚轮以指针为中心，双击在 1× 与 2.4× 之间切换 */
        stage.addEventListener(
          'wheel',
          (event) => {
            event.preventDefault();
            const at = pointerAt(event);
            zoomAt(zoom * Math.exp(-event.deltaY * 0.0022), at.x, at.y);
          },
          { passive: false }
        );

        stage.addEventListener('dblclick', (event) => {
          const at = pointerAt(event);
          if (zoom > 1) reset();
          else zoomAt(2.4, at.x, at.y);
        });

        /* 拖动只在放大后生效，否则会和双击、切换图片抢事件 */
        let drag: { x: number; y: number; dx: number; dy: number } | null = null;
        stage.addEventListener('pointerdown', (event) => {
          if (zoom <= 1) return;
          drag = { x: event.clientX, y: event.clientY, dx: tx, dy: ty };
          stage.setPointerCapture(event.pointerId);
          stage.classList.add('is-dragging');
        });

        stage.addEventListener('pointermove', (event) => {
          if (!drag) return;
          tx = drag.dx + event.clientX - drag.x;
          ty = drag.dy + event.clientY - drag.y;
          clamp();
          paint();
        });

        const endDrag = (event: PointerEvent) => {
          if (!drag) return;
          drag = null;
          stage.classList.remove('is-dragging');
          if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
        };

        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);

        /* 换图后尺寸变了，按新尺寸重新收边界 */
        view.addEventListener('load', () => {
          if (zoom > 1) {
            clamp();
            paint();
          }
        });

        lightbox.querySelector('.lightbox-close')?.addEventListener('click', () => lightbox.close());
        prev?.addEventListener('click', () => show(index - 1));
        next?.addEventListener('click', () => show(index + 1));
        lightbox.addEventListener('click', (event) => {
          if (event.target === lightbox) lightbox.close();
        });
        lightbox.addEventListener('keydown', (event) => {
          const key = event.key;
          if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', '_', '0'].includes(key)) return;
          event.preventDefault();
          if (key === 'ArrowLeft') show(index - 1);
          else if (key === 'ArrowRight') show(index + 1);
          else if (key === '0') reset();
          else zoomAt(['+', '='].includes(key) ? zoom * 1.25 : zoom / 1.25, 0, 0);
        });
        lightbox.addEventListener('close', () => {
          document.documentElement.style.overflow = '';
          reset();
          hint?.classList.remove('is-on');
          window.clearTimeout(hintTimer);
        });
      }
}
