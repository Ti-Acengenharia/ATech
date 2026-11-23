import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import './MediaViewerModal.css'

export type MediaType = 'image' | 'pdf' | 'video' | 'audio' | 'other'

export interface MediaViewerItem {
  id?: string | number
  title: string
  url: string
  downloadUrl?: string
  mimeType?: string
  fileSize?: number | string
  createdAt?: string
  source?: string
  type?: MediaType
}

export function detectMediaType(fileName: string, mimeType?: string, url?: string): MediaType {
  const mime = (mimeType || '').toLowerCase()
  if (mime.includes('pdf')) return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'

  const target = (fileName || url || '').toLowerCase().split('?')[0]
  if (/\.(jpe?g|png|webp|gif|svg|bmp|ico|avif)$/i.test(target)) return 'image'
  if (/\.pdf$/i.test(target)) return 'pdf'
  if (/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(target)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(target)) return 'audio'

  return 'other'
}

function formatFileSize(size: number | string | undefined): string {
  if (size === undefined || size === null || size === '') return ''
  if (typeof size === 'string') {
    if (size.toLowerCase().includes('b')) return size
    const num = Number(size)
    if (Number.isNaN(num)) return size
    size = num
  }
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

interface MediaViewerModalProps {
  items: MediaViewerItem[]
  initialIndex?: number
  onClose: () => void
}

export default function MediaViewerModal({ items, initialIndex = 0, onClose }: MediaViewerModalProps) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(initialIndex, items.length - 1)))
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [showThumbnails, setShowThumbnails] = useState(true)
  const [loading, setLoading] = useState(true)

  const modalRef = useRef<HTMLDivElement>(null)
  const thumbnailStripRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const currentItem = items[index]
  const currentType = currentItem ? (currentItem.type || detectMediaType(currentItem.title, currentItem.mimeType, currentItem.url)) : 'other'

  // Bloqueio do scroll do body enquanto o visualizador estiver aberto
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // Foco imediato no modal e reset de zoom/rotação ao mudar de item
  useEffect(() => {
    setZoom(1)
    setRotation(0)
    setLoading(true)
    modalRef.current?.focus()
  }, [index])

  // Scroll suave no carrossel inferior para manter a miniatura ativa centralizada
  useEffect(() => {
    if (thumbnailStripRef.current) {
      const activeThumb = thumbnailStripRef.current.children[index] as HTMLElement | undefined
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      }
    }
  }, [index])

  // Navegação por teclado
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft') {
        goToPrevious()
      } else if (event.key === 'ArrowRight') {
        goToNext()
      } else if (event.key === '+' || event.key === '=') {
        if (currentType === 'image') handleZoomIn()
      } else if (event.key === '-') {
        if (currentType === 'image') handleZoomOut()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items.length, currentType, onClose])

  function goToPrevious() {
    setIndex((curr) => (curr > 0 ? curr - 1 : items.length - 1))
  }

  function goToNext() {
    setIndex((curr) => (curr < items.length - 1 ? curr + 1 : 0))
  }

  function handleZoomIn() {
    setZoom((curr) => Math.min(3, Number((curr + 0.25).toFixed(2))))
  }

  function handleZoomOut() {
    setZoom((curr) => Math.max(0.5, Number((curr - 0.25).toFixed(2))))
  }

  function handleRotate() {
    setRotation((curr) => (curr + 90) % 360)
  }

  function handleResetTransform() {
    setZoom(1)
    setRotation(0)
  }

  function handleImageDoubleClick() {
    setZoom((curr) => (curr === 1 ? 2 : 1))
  }

  // Gestos de toque (swipe) para mobile
  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null

    // Só dispara se o swipe for predominantemente horizontal e maior que 45px
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < 0) {
        goToNext()
      } else {
        goToPrevious()
      }
    }
  }

  if (!currentItem) return null

  const downloadUrl = currentItem.downloadUrl || currentItem.url
  const formattedSize = formatFileSize(currentItem.fileSize)

  const content = (
    <div
      className="media-viewer-backdrop"
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de Arquivos"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Barra superior de ferramentas */}
      <header className="media-viewer-header">
        <div className="media-viewer-info">
          {currentType === 'image' && <ImageIcon size={18} className="media-viewer-type-icon is-image" />}
          {currentType === 'pdf' && <FileText size={18} className="media-viewer-type-icon is-pdf" />}
          {currentType === 'video' && <Film size={18} className="media-viewer-type-icon is-video" />}
          {currentType === 'audio' && <Music size={18} className="media-viewer-type-icon is-audio" />}
          {currentType === 'other' && <File size={18} className="media-viewer-type-icon is-other" />}

          <div className="media-viewer-title-group">
            <h2 className="media-viewer-title" title={currentItem.title}>
              {currentItem.title}
            </h2>
            <div className="media-viewer-meta">
              {items.length > 1 && (
                <span className="media-viewer-counter">
                  {index + 1} de {items.length}
                </span>
              )}
              {currentItem.source && (
                <span className="media-viewer-source-tag">{currentItem.source}</span>
              )}
              {formattedSize && (
                <span className="media-viewer-size-tag">{formattedSize}</span>
              )}
            </div>
          </div>
        </div>

        <div className="media-viewer-actions">
          {currentType === 'image' && (
            <div className="media-viewer-image-tools">
              <button
                type="button"
                className="media-viewer-btn"
                onClick={handleZoomIn}
                title="Ampliar zoom (+)"
                disabled={zoom >= 3}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-btn"
                onClick={handleZoomOut}
                title="Reduzir zoom (-)"
                disabled={zoom <= 0.5}
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-btn"
                onClick={handleRotate}
                title="Girar imagem 90°"
              >
                <RotateCw size={16} />
              </button>
              {zoom !== 1 && (
                <button
                  type="button"
                  className="media-viewer-btn text-btn"
                  onClick={handleResetTransform}
                  title="Ajustar à tela"
                >
                  {Math.round(zoom * 100)}%
                </button>
              )}
            </div>
          )}

          <a
            href={downloadUrl}
            download={currentItem.title}
            className="media-viewer-btn is-download"
            title="Baixar arquivo para o computador"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} />
            <span>Baixar</span>
          </a>

          <a
            href={currentItem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="media-viewer-btn"
            title="Abrir em nova aba"
          >
            <ExternalLink size={16} />
          </a>

          <button
            type="button"
            className="media-viewer-btn is-close"
            onClick={onClose}
            title="Fechar (Esc)"
            aria-label="Fechar visualizador"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Conteúdo central da mídia (Stage) */}
      <main className="media-viewer-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
        {items.length > 1 && (
          <button
            type="button"
            className="media-viewer-nav-btn is-prev"
            onClick={(e) => { e.stopPropagation(); goToPrevious() }}
            title="Arquivo anterior (Seta esquerda)"
            aria-label="Arquivo anterior"
          >
            <ChevronLeft size={30} />
          </button>
        )}

        <div className="media-viewer-canvas">
          {currentType === 'image' && (
            <div className="media-viewer-image-wrapper">
              {loading && <LoaderCircle size={36} className="media-viewer-spinner" style={{ color: '#38bdf8', animation: 'spin 1s linear infinite' }} />}
              <img
                src={currentItem.url}
                alt={currentItem.title}
                className={`media-viewer-img ${zoom > 1 ? 'is-zoomed' : ''}`}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  display: loading ? 'none' : 'block',
                }}
                onLoad={() => setLoading(false)}
                onError={() => setLoading(false)}
                onDoubleClick={handleImageDoubleClick}
                draggable={false}
                title="Toque duas vezes ou dê duplo clique para alternar o zoom"
              />
            </div>
          )}

          {currentType === 'pdf' && (
            <div className="media-viewer-pdf-wrapper">
              <iframe
                src={currentItem.url}
                title={currentItem.title}
                className="media-viewer-iframe"
                onLoad={() => setLoading(false)}
              />
            </div>
          )}

          {currentType === 'video' && (
            <div className="media-viewer-video-wrapper">
              <video
                src={currentItem.url}
                controls
                autoPlay
                playsInline
                className="media-viewer-video"
                onLoadedData={() => setLoading(false)}
              >
                Seu navegador não suporta a reprodução deste vídeo.
              </video>
            </div>
          )}

          {currentType === 'audio' && (
            <div className="media-viewer-audio-wrapper">
              <div className="media-viewer-audio-card">
                <Music size={44} className="media-viewer-audio-icon" />
                <h3>{currentItem.title}</h3>
                <audio
                  src={currentItem.url}
                  controls
                  autoPlay
                  className="media-viewer-audio"
                  onLoadedData={() => setLoading(false)}
                />
              </div>
            </div>
          )}

          {currentType === 'other' && (
            <div className="media-viewer-fallback-card">
              <FileText size={56} className="media-viewer-fallback-icon" />
              <h3>{currentItem.title}</h3>
              <p>Visualização direta não disponível para este tipo de arquivo.</p>
              {formattedSize && <span className="media-viewer-fallback-size">{formattedSize}</span>}
              <div className="media-viewer-fallback-actions">
                <a
                  href={downloadUrl}
                  download={currentItem.title}
                  className="primary-button"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={16} /> Baixar arquivo
                </a>
                <a
                  href={currentItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button"
                >
                  <ExternalLink size={16} /> Abrir link
                </a>
              </div>
            </div>
          )}
        </div>

        {items.length > 1 && (
          <button
            type="button"
            className="media-viewer-nav-btn is-next"
            onClick={(e) => { e.stopPropagation(); goToNext() }}
            title="Próximo arquivo (Seta direita)"
            aria-label="Próximo arquivo"
          >
            <ChevronRight size={30} />
          </button>
        )}
      </main>

      {/* Barra inferior de navegação por miniaturas / carrossel */}
      {items.length > 1 && (
        <footer className="media-viewer-footer">
          <button
            type="button"
            className="media-viewer-strip-toggle"
            onClick={() => setShowThumbnails((v) => !v)}
            title="Alternar lista de arquivos"
          >
            <span>{showThumbnails ? 'Ocultar miniaturas' : 'Ver miniaturas dos arquivos'} ({items.length})</span>
          </button>

          {showThumbnails && (
            <div className="media-viewer-thumbnails-strip" ref={thumbnailStripRef}>
              {items.map((item, idx) => {
                const itemType = item.type || detectMediaType(item.title, item.mimeType, item.url)
                const isActive = idx === index
                return (
                  <button
                    type="button"
                    key={item.id ?? `${item.url}-${idx}`}
                    className={`media-viewer-thumb-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => setIndex(idx)}
                    title={item.title}
                  >
                    <div className="media-viewer-thumb-preview">
                      {itemType === 'image' ? (
                        <img src={item.url} alt="" loading="lazy" />
                      ) : itemType === 'pdf' ? (
                        <FileText size={18} className="thumb-icon is-pdf" />
                      ) : itemType === 'video' ? (
                        <Film size={18} className="thumb-icon is-video" />
                      ) : (
                        <File size={18} className="thumb-icon" />
                      )}
                    </div>
                    <span className="media-viewer-thumb-label">{item.title}</span>
                  </button>
                )
              })}
            </div>
          )}
        </footer>
      )}
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body)
  }

  return content
}
