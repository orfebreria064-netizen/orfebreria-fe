import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastModule, ConfirmDialogModule],
  template: `
    <p-toast position="top-right" [breakpoints]="{ '640px': { width: 'calc(100vw - 1.5rem)', right: '0.75rem', left: '0.75rem' } }" />
    <!-- Sin acceptLabel/rejectLabel: tendrían prioridad sobre los textos de cada confirmación
         (acceptButtonProps.label). El «Sí / No» por defecto sale de la traducción (PRIMENG_ES). -->
    <p-confirmdialog [style]="{ width: '440px' }" />
    <router-outlet />
  `,
})
export class App {}
