import { INotificationService } from "exocortex";
import { Notice } from "obsidian";

export class ObsidianNotificationService implements INotificationService {
  private readonly DEFAULT_DURATION = 4000;

  info(message: string, duration?: number): void {
    new Notice(message, duration || this.DEFAULT_DURATION);
  }

  success(message: string, duration?: number): void {
    new Notice(`✓ ${message}`, duration || this.DEFAULT_DURATION);
  }

  error(message: string, duration?: number): void {
    new Notice(`✗ ${message}`, duration || this.DEFAULT_DURATION);
  }

  warn(message: string, duration?: number): void {
    new Notice(`⚠ ${message}`, duration || this.DEFAULT_DURATION);
  }

  async confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal-container mod-confirmation";

      const modalContent = document.createElement("div");
      modalContent.className = "modal";

      const titleEl = document.createElement("div");
      titleEl.className = "modal-title";
      titleEl.textContent = title;

      const messageEl = document.createElement("div");
      messageEl.className = "modal-content";
      messageEl.textContent = message;

      const buttonContainer = document.createElement("div");
      buttonContainer.className = "modal-button-container";

      const confirmButton = document.createElement("button");
      confirmButton.className = "mod-cta";
      confirmButton.textContent = "Confirm";
      confirmButton.onclick = () => {
        modal.remove();
        resolve(true);
      };

      const cancelButton = document.createElement("button");
      cancelButton.textContent = "Cancel";
      cancelButton.onclick = () => {
        modal.remove();
        resolve(false);
      };

      buttonContainer.appendChild(confirmButton);
      buttonContainer.appendChild(cancelButton);

      modalContent.appendChild(titleEl);
      modalContent.appendChild(messageEl);
      modalContent.appendChild(buttonContainer);

      modal.appendChild(modalContent);
      document.body.appendChild(modal);
    });
  }
}
