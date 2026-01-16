import { Component, ElementRef, ViewChild, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { GenAiService } from './services/gen-ai.service';
import { UiRendererComponent, FormChangeEvent } from './components/ui-renderer/ui-renderer.component';
import { ChatMessage, A2UIComponent } from './types/a2ui.types';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, UiRendererComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  
  private genAiService = inject(GenAiService);
  private fb = inject(FormBuilder);
  
  messages = signal<ChatMessage[]>([]);
  userInput = signal<string>('');
  isLoading = signal<boolean>(false);
  isSettingsOpen = signal<boolean>(false);
  isConnecting = signal<boolean>(false);
  connectionStatus = signal<'disconnected' | 'connected' | 'error'>('disconnected');

  // Stores live form data from the A2UI interfaces
  // Key: input ID, Value: { value, isValid }
  activeFormData = signal<Record<string, { value: string, isValid: boolean }>>({});

  // Configuration Form
  configForm = this.fb.group({
    endpoint: ['', [Validators.required]],
    api_key: ['', [Validators.required]],
    deployment_name: ['gpt-4o', [Validators.required]],
    api_version: ['2024-05-01-preview', [Validators.required]],
    mcp_servers: ['']
  });

  constructor() {
    // Initial greeting
    this.addSystemMessage({
      type: 'container',
      props: { direction: 'col', gap: 'md' },
      children: [
        {
          type: 'card',
          props: { variant: 'filled' },
          children: [
             {
               type: 'container',
               props: { direction: 'row', align: 'center', gap: 'md' },
               children: [
                 { type: 'text', props: { content: '✨', size: 'xl' } },
                 { type: 'text', props: { content: 'A2UI Interface Ready', size: 'lg', bold: true, color: 'text-white' } }
               ]
             },
             { type: 'divider' },
             { type: 'text', props: { content: 'Please configure your Azure OpenAI settings to begin.', size: 'md' } },
             { 
               type: 'container', 
               props: { direction: 'row', gap: 'sm' },
               children: [
                 { type: 'button', props: { label: 'Configure Agent', action: 'open_settings', variant: 'primary' } },
                 { type: 'button', props: { label: 'ServiceNow Demo', action: 'demo_servicenow', variant: 'secondary' } }
               ]
             }
          ]
        }
      ]
    });

    // Auto-scroll effect: Only runs when messages change
    effect(() => {
      const msgs = this.messages();
      // Use setTimeout to allow DOM to render
      setTimeout(() => this.scrollToBottom(), 100);
    });
  }

  toggleSettings() {
    this.isSettingsOpen.update(v => !v);
  }

  async connectAgent() {
    if (this.configForm.invalid) {
      this.configForm.markAllAsTouched();
      return;
    }

    this.isConnecting.set(true);
    this.connectionStatus.set('disconnected');

    const config = {
      endpoint: this.configForm.value.endpoint!,
      api_key: this.configForm.value.api_key!,
      deployment_name: this.configForm.value.deployment_name!,
      api_version: this.configForm.value.api_version!,
      mcp_servers: this.configForm.value.mcp_servers || ''
    };

    try {
      await this.genAiService.connect(config);
      this.connectionStatus.set('connected');
      this.isSettingsOpen.set(false);
      
      this.addSystemMessage({
        type: 'container',
        props: { direction: 'col', gap: 'sm' },
        children: [
          { type: 'badge', props: { label: 'Connected', variant: 'success' } },
          { type: 'text', props: { content: `Successfully connected to ${config.deployment_name}` } }
        ]
      });

    } catch (err) {
      this.connectionStatus.set('error');
      console.error('Connection Failed', err);
    } finally {
      this.isConnecting.set(false);
    }
  }

  private scrollToBottom(): void {
    if (this.scrollContainer?.nativeElement) {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    }
  }

  /**
   * Sends a message to the agent.
   * @param promptText The technical prompt sent to the LLM (includes JSON/Context).
   * @param displayText The friendly text shown in the user's chat bubble. Defaults to promptText.
   */
  async sendMessage(promptText?: string, displayText?: string) {
    const textToSend = promptText || this.userInput();
    const textToDisplay = displayText || textToSend;
    
    if (!textToSend.trim() || this.isLoading()) return;

    // Capture history BEFORE adding the new message
    const history = this.messages().map(m => ({
      role: m.role,
      parts: [{ text: m.role === 'user' ? (m.promptContent || m.content) : JSON.stringify(m.ui) }]
    }));

    // Add User Message to UI
    this.messages.update(msgs => [...msgs, {
      role: 'user',
      content: textToDisplay,
      promptContent: textToSend,
      timestamp: new Date()
    }]);

    this.userInput.set('');
    this.isLoading.set(true);

    try {
      const uiResponse = await this.genAiService.generateResponse(textToSend, history);
      this.addSystemMessage(uiResponse);
    } catch (error) {
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  // --- Handling Dynamic UI Events ---

  handleFormChange(event: FormChangeEvent) {
    this.activeFormData.update(current => ({
      ...current,
      [event.id]: { value: event.value, isValid: event.isValid }
    }));
  }

  handleUiAction(actionId: string) {
    if (actionId === 'open_settings') {
      this.isSettingsOpen.set(true);
      return;
    }

    // Capture current form data state
    const currentFormData = this.activeFormData();
    
    const invalidFields = Object.entries(currentFormData)
      .filter(([_, data]) => !data.isValid)
      .map(([id]) => id);

    let prompt = `User triggered action: ${actionId}.`;
    let display = `Triggered Action: ${actionId}`;

    if (Object.keys(currentFormData).length > 0) {
      // Create a clean object of values to send
      const values: Record<string, string> = {};
      Object.entries(currentFormData).forEach(([k, v]) => values[k] = v.value);
      
      // Inject submitted data into context
      prompt += `\n\nSubmitted Form Data:\n${JSON.stringify(values, null, 2)}`;
      display += ` (Submitted Data)`;
      
      if (invalidFields.length > 0) {
        prompt += `\n\nWarning: The following fields have validation errors: ${invalidFields.join(', ')}`;
        display += ` ⚠️ Invalid Fields`;
      }

      // CRITICAL FIX: Clear form data after submission so it doesn't pollute future requests.
      // This prevents "state leak" where old form data attaches to new requests.
      this.activeFormData.set({});
    } else {
      // Fallback prompts for demo buttons
      if (actionId === 'demo_product') {
         prompt = 'Generate a stylish product card for high-end headphones with an image, price, and buy button.';
         display = 'Show me a product demo';
      }
      else if (actionId === 'demo_list') {
         prompt = 'Create a checklist of 5 things to do for a healthy morning routine.';
         display = 'Show me a list demo';
      }
      else if (actionId === 'demo_servicenow') {
         prompt = 'Generate a Standard ServiceNow Change Request form in a SINGLE card. Include at least these 10 fields: Change Number (readonly), Requested By, State, Priority, Risk, Short Description, Description, Assignment Group, Planned Start Date, and Planned End Date. Use Dividers to separate sections like "General", "Schedule", and "Planning".';
         display = 'Create a Standard ServiceNow Change Request';
      }
    }
    
    // Send message with separated prompt and display text
    this.sendMessage(prompt, display);
  }

  private addSystemMessage(ui: A2UIComponent) {
    this.messages.update(msgs => [...msgs, {
      role: 'model',
      ui: ui,
      timestamp: new Date()
    }]);
  }
}