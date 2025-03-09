class VoiceMessageHandler {
    constructor() {
        this.activeAudio = null;
        this.isPlaying = false;
    }

    initializeVoiceMessage(element, url) {
        const audio = new Audio(url);
        const playButton = element.querySelector('.play-pause');
        const progress = element.querySelector('.voice-progress');
        const duration = element.querySelector('.duration');

        audio.addEventListener('loadedmetadata', () => {
            duration.textContent = this.formatDuration(audio.duration);
        });

        audio.addEventListener('timeupdate', () => {
            const percent = (audio.currentTime / audio.duration) * 100;
            progress.style.width = `${percent}%`;
            duration.textContent = this.formatDuration(audio.currentTime);
        });

        audio.addEventListener('ended', () => {
            this.isPlaying = false;
            playButton.innerHTML = '<i class="ri-play-fill"></i>';
        });

        playButton.addEventListener('click', () => {
            if (this.activeAudio && this.activeAudio !== audio) {
                this.activeAudio.pause();
                this.activeAudio.currentTime = 0;
            }

            if (this.isPlaying) {
                audio.pause();
                playButton.innerHTML = '<i class="ri-play-fill"></i>';
            } else {
                audio.play();
                playButton.innerHTML = '<i class="ri-pause-fill"></i>';
                this.activeAudio = audio;
            }
            this.isPlaying = !this.isPlaying;
        });
    }

    formatDuration(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

const voiceHandler = new VoiceMessageHandler();
export default voiceHandler;
