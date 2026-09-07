import { scanFields } from "./dom-scanner";

export type WorkdayStep = 
    | "start_application" 
    | "sign_in" 
    | "create_account" 
    | "my_information" 
    | "my_experience" 
    | "application_questions" 
    | "voluntary_disclosures" 
    | "self_identify" 
    | "review" 
    | "unknown";

export class WorkdayNavigator {
    private observer?: MutationObserver;
    private currentStep: WorkdayStep = "unknown";
    
    private changeTimer?: ReturnType<typeof setTimeout>;

    start(onChange: () => void) {
        // Workday re-renders the same step repeatedly; react to every
        // relevant render. Mutations caused by our own floating panel are
        // ignored so the observer can never feed back into itself.
        // React to mutations on a DEBOUNCE: Workday fires hundreds of mutation
        // batches while loading, and running detection (plus the fill callback)
        // synchronously on each one blocked the page's main thread and made the
        // site feel frozen. A short trailing debounce coalesces them into one.
        const isOwnPanel = (n: Node) =>
            n instanceof HTMLElement &&
            (n.id === "workday-ai-autofill-panel" ||
                (n.closest && n.closest("#workday-ai-autofill-panel") !== null));
        this.observer = new MutationObserver(ms => {
            const relevant = ms.some(m =>
                Array.from(m.addedNodes).some(n => !isOwnPanel(n)),
            );
            if (relevant) {
                clearTimeout(this.changeTimer);
                this.changeTimer = setTimeout(() => {
                    this.detectCurrentStep();
                    onChange();
                }, 400);
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
        this.detectCurrentStep(); // Initial detection
    }
    
    stop() { this.observer?.disconnect(); }
    
    detectCurrentStep(): WorkdayStep {
        const title = document.title.toLowerCase();

        // NOTE: never read document.body.innerText here. It forces a full
        // layout + serializes the whole page and, run on every mutation, it
        // made Workday pages take seconds to become interactive. Read only
        // small, targeted element lists instead.
        const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const headings = [
            ...document.querySelectorAll<HTMLElement>(
                "h1, h2, h3, [data-automation-id='sectionHeading'], [role='heading']",
            ),
        ].map((h) => clean(h.textContent)).filter(Boolean);
        // Button/link labels cover the phrases previously read from body text
        // ("Apply Manually", "Autofill with Resume", "Sign in to continue").
        const actions = [
            ...document.querySelectorAll<HTMLElement>(
                "button, [role='button'], input[type='submit'], a[data-automation-id], [data-automation-id*='apply']",
            ),
        ].map((b) => clean(b.textContent || (b as HTMLInputElement).value || "")).filter(Boolean);
        // The page's own <h1> is the strongest signal: the step progress bar
        // lists every step label in body text on all pages, which previously
        // made "My Information" match everywhere.
        const h1s = [...document.querySelectorAll<HTMLElement>("h1")]
            .map((h) => clean(h.textContent)).filter(Boolean);

        const STEP_KEYS: Array<{ key: WorkdayStep; label: string }> = [
            { key: "my_information", label: "my information" },
            { key: "my_experience", label: "my experience" },
            { key: "application_questions", label: "application questions" },
            { key: "voluntary_disclosures", label: "voluntary disclosures" },
            { key: "self_identify", label: "self identify" },
            { key: "review", label: "review" },
        ];
        const match = (t: string, label: string) => t === label || t.includes(label);

        // 1. Page h1
        for (const { key, label } of STEP_KEYS) {
            if (h1s.some((t) => match(t, label))) {
                this.currentStep = key;
                console.log(`Detected current step: ${this.currentStep}`);
                return this.currentStep;
            }
        }
        if (h1s.some((t) => match(t, "sign in"))) {
            this.currentStep = "sign_in";
            console.log(`Detected current step: ${this.currentStep}`);
            return this.currentStep;
        }
        if (h1s.some((t) => match(t, "create account"))) {
            this.currentStep = "create_account";
            console.log(`Detected current step: ${this.currentStep}`);
            return this.currentStep;
        }

        // 2. Other headings, then body text. Auth via headings only (site
        // chrome contains "Sign In" links on every page).
        for (const { key, label } of STEP_KEYS) {
            if (headings.some((t) => match(t, label))) {
                this.currentStep = key;
                console.log(`Detected current step: ${this.currentStep}`);
                return this.currentStep;
            }
        }
        if (actions.some((t) => t.includes("autofill with resume") || t.includes("apply manually") || t.includes("start your application"))) {
            this.currentStep = "start_application";
        } else if (headings.some((t) => match(t, "sign in")) || actions.some((t) => t.includes("sign in to continue"))) {
            this.currentStep = "sign_in";
        } else if (headings.some((t) => match(t, "create account"))) {
            this.currentStep = "create_account";
        } else if (title.includes("my information")) {
            this.currentStep = "my_information";
        } else if (title.includes("my experience")) {
            this.currentStep = "my_experience";
        } else if (title.includes("application questions")) {
            this.currentStep = "application_questions";
        } else if (title.includes("voluntary disclosures")) {
            this.currentStep = "voluntary_disclosures";
        } else {
            this.currentStep = "unknown";
        }

        console.log(`Detected current step: ${this.currentStep}`);
        return this.currentStep;
    }
    
    getCurrentStep(): WorkdayStep {
        return this.currentStep;
    }
    
    // Handle "Apply Manually" button on start page
    async clickApplyManually(): Promise<{ success: boolean; message: string }> {
        try {
            const manualButtonSelectors = [
                "//button[contains(text(), 'Apply Manually')]",
                "//a[contains(text(), 'Apply Manually')]",
                "[data-automation-id='applyManually']",
            ];
            
            let manualButton = null;
            
            for (const selector of manualButtonSelectors) {
                try {
                    if (selector.startsWith("//")) {
                        const elements = document.evaluate(
                            selector, 
                            document, 
                            null, 
                            XPathResult.FIRST_ORDERED_NODE_TYPE, 
                            null
                        );
                        manualButton = elements.singleNodeValue as HTMLElement;
                    } else {
                        manualButton = document.querySelector(selector) as HTMLElement;
                    }
                    
                    if (manualButton && this.isElementVisible(manualButton)) {
                        console.log(`Found Apply Manually button with selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (manualButton) {
                manualButton.click();
                return { 
                    success: true, 
                    message: "Successfully clicked Apply Manually button" 
                };
            } else {
                return { 
                    success: false, 
                    message: "Could not find Apply Manually button" 
                };
            }
        } catch (error) {
            return { 
                success: false, 
                message: `Error clicking Apply Manually: ${String(error)}` 
            };
        }
    }
    
    // Handle "Add Another" button for repeatable sections
    async clickAddAnother(): Promise<{ success: boolean; message: string }> {
        try {
            const addAnotherSelectors = [
                "//button[contains(text(), 'Add Another')]",
                "//button[contains(text(), 'Add')]",
                "//a[contains(text(), 'Add Another')]",
                "//a[contains(text(), 'Add')]",
                "[data-automation-id='addAnother']",
                "[data-automation-id='addButton']",
            ];
            
            let addButton = null;
            
            for (const selector of addAnotherSelectors) {
                try {
                    if (selector.startsWith("//")) {
                        const elements = document.evaluate(
                            selector, 
                            document, 
                            null, 
                            XPathResult.FIRST_ORDERED_NODE_TYPE, 
                            null
                        );
                        addButton = elements.singleNodeValue as HTMLElement;
                    } else {
                        addButton = document.querySelector(selector) as HTMLElement;
                    }
                    
                    if (addButton && this.isElementVisible(addButton)) {
                        console.log(`Found Add Another button with selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (addButton) {
                addButton.click();
                return { 
                    success: true, 
                    message: "Successfully clicked Add Another button" 
                };
            } else {
                return { 
                    success: false, 
                    message: "Could not find Add Another button" 
                };
            }
        } catch (error) {
            return { 
                success: false, 
                message: `Error clicking Add Another: ${String(error)}` 
            };
        }
    }
    
    // Candidate button labels for advancing the current step. Exact label
    // matches win over substring matches. "Submit" is intentionally absent:
    // the extension never submits the application.
    private nextButtonLabelsFor(step: WorkdayStep): string[] {
        switch (step) {
            case "start_application":
                return ["Apply Manually", "Sign In", "Sign up with Email", "Create Account", "Next", "Continue"];
            case "sign_in":
                return ["Sign In", "Sign in with Email", "Next", "Continue"];
            case "create_account":
                return ["Create Account", "Sign Up", "Next", "Continue"];
            case "my_information":
            case "my_experience":
            case "application_questions":
            case "voluntary_disclosures":
            case "self_identify":
                return ["Save and Continue", "Next", "Continue", "Done"];
            default:
                return ["Next", "Continue", "Save and Continue", "Done"];
        }
    }

    // Find a visible button whose label equals (preferred) or contains the
    // given text. Works with Workday's nested <button><span>... markup where
    // text-based XPath on text() nodes fails.
    private findButtonByText(text: string): HTMLElement | null {
        const lower = text.toLowerCase();
        const candidates = document.querySelectorAll<HTMLElement>(
            "button, [role='button'], input[type='submit'], a",
        );
        let partial: HTMLElement | null = null;
        for (const el of candidates) {
            if (!this.isElementVisible(el)) continue;
            const label = (el.innerText || (el as HTMLInputElement).value || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            if (!label) continue;
            if (label === lower) return el; // exact match wins immediately
            if (!partial && label.includes(lower)) partial = el; // first substring match
        }
        return partial;
    }
    
    async navigateToNextStep(): Promise<{ success: boolean; message: string }> {
        try {
            this.detectCurrentStep();

            // Final review is always manual - never click anything there.
            if (this.currentStep === "review") {
                return {
                    success: false,
                    message:
                        "You are on the Review step. Verify your answers and click Submit yourself - the extension never submits.",
                };
            }

            for (const text of this.nextButtonLabelsFor(this.currentStep)) {
                const btn = this.findButtonByText(text);
                if (btn) {
                    console.log(`Found step button "${text}" for step ${this.currentStep}`);
                    btn.click();
                    return {
                        success: true,
                        message: `Clicked "${text}" (step: ${this.currentStep}).`,
                    };
                }
            }

            return {
                success: false,
                message: `Could not find a next/continue button for step "${this.currentStep}". You may need to navigate manually.`,
            };
        } catch (error) {
            return {
                success: false,
                message: `Error navigating to next step: ${String(error)}`,
            };
        }
    }
    
    // detects these states and waits. It never fills or clicks anything
    // related to signing in.
    isAuthenticationStep(): boolean {
        return this.currentStep === "sign_in" || this.currentStep === "create_account";
    }

    // labels once per entry, so the entry count is the max number of fields
    // sharing any single label.
    countExperienceEntries(): number {
        const counts = new Map<string, number>();
        for (const f of scanFields()) {
            const key = (f.label || f.name || f.id).toLowerCase().replace(/\s+/g, " ").trim();
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return counts.size ? Math.max(...counts.values()) : 0;
    }

    // Navigate to Workday's Review page from the last application step.
    // Matches only labels containing "review" that are NOT the final submit.
    continueToReview(): { success: boolean; message: string } {
        const candidates = document.querySelectorAll<HTMLElement>(
            "button, [role='button'], input[type='submit'], a",
        );
        let partial: HTMLElement | null = null;
        for (const el of candidates) {
            if (!this.isElementVisible(el)) continue;
            const label = (el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().toLowerCase();
            if (!label || !label.includes("review") || label.includes("submit")) continue;
            if (label === "review") {
                el.click();
                return { success: true, message: 'Clicked "Review".' };
            }
            partial = partial || el;
        }
        if (partial) {
            partial.click();
            return { success: true, message: `Navigated to review via "${partial.innerText.trim()}". Verify and submit manually.` };
        }
        return { success: false, message: "Could not find a Review button. Please navigate manually." };
    }

    // Click the "Add" button that belongs to a specific section (e.g.
    // "Work Experience", "Education"). Sections are identified by their
    // heading; the Add button is the first visible one positioned after it.
    async clickAddInSection(section: string): Promise<boolean> {
        const isAdd = (b: HTMLElement) => {
            const t = (b.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
            return this.isElementVisible(b) && (t === "add" || t === "add another" || t === "+ add");
        };
        const adds = [...document.querySelectorAll<HTMLElement>("button, [role='button']")].filter(isAdd);
        if (!adds.length) return false;

        const headings = [
            ...document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, [data-automation-id='sectionHeading']"),
        ].filter((h) => (h.textContent || "").toLowerCase().includes(section.toLowerCase()));

        for (const h of headings) {
            const after = adds.filter((a) => h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (after.length) {
                after[0].click();
                return true;
            }
        }
        // Fallback: first visible Add button.
        adds[0].click();
        return true;
    }

    private isElementVisible(element: HTMLElement): boolean {
        return element.offsetWidth > 0 && element.offsetHeight > 0;
    }
    
    summary() { 
        const f = scanFields(); 
        return { 
            url: location.href, 
            title: document.title, 
            currentStep: this.currentStep,
            fieldCount: f.length, 
            labels: f.map(x => x.label).filter(Boolean) 
        }; 
    }
}
