import {
  choice,
  noul,
  score,
  TypeSafeClient,
  type ChoiceResponse,
  type NoulResponse,
  type Question,
  type Questions,
  type ScoreResponse,
} from "@typesafe-ai/sdk";
import { config } from "./config.ts";

/** Bump when questions or state shape change so cached evaluations are recomputed. */
export const QUESTIONS_VERSION = 2;

export type CustomerMessage = {
  id: string;
  channel: "email" | "support portal";
  from: string;
  sent: string;
  text: string;
};

export type EngineerNote = {
  id: string;
  author: string;
  written: string;
  text: string;
};

export type SentimentState = {
  case: { subject: string; status: string };
  customer_messages: CustomerMessage[];
  bmc_engineer_notes: EngineerNote[];
};

const CUSTOMER_OWN_WORDS =
  "Judge only the customer's own words. Quoted error messages, log output, and job statuses are not the customer's tone.";

function customerSignal(question: string, yes: string, no: string) {
  return noul(
    { question: `In \`customer_messages\`, ${question}`, note: CUSTOMER_OWN_WORDS },
    { true: yes, false: no },
  );
}

export const SIGNALS = {
  frustrated: {
    label: "Frustrated or angry tone",
    question: customerSignal(
      "does the customer express frustration, annoyance, or anger?",
      "The customer's own words show frustration, annoyance, anger, or exasperation, for example complaints, exclamations, sarcasm, or calling the situation unacceptable.",
      "The customer is neutral, businesslike, polite, or appreciative, including when they only report a technical problem or ask a question.",
    ),
  },
  slowSupport: {
    label: "Complains about slow response",
    question: customerSignal(
      "does the customer complain about slow responses, a lack of updates, or waiting too long for BMC support?",
      "The customer complains about delays, unanswered messages, how long the case is taking, or asks why nobody has replied.",
      "No complaint about response time. A polite request for a status update is not a complaint.",
    ),
  },
  escalation: {
    label: "Asks to escalate",
    question: customerSignal(
      "does the customer ask to escalate the case, raise its priority or severity, speak with a manager, or involve their BMC account team?",
      "The customer requests escalation, a higher priority or severity, a manager, or their account team.",
      "The customer makes no such request.",
    ),
  },
  unresolved: {
    label: "Fix did not work / repeating themselves",
    question: customerSignal(
      "does the customer say that a suggested fix did not work, that the problem keeps coming back, or that they have to repeat information they already provided?",
      "The customer reports a failed suggestion, a recurring problem, or having to repeat themselves.",
      "The customer does not report any of these.",
    ),
  },
  unhappyWithHelp: {
    label: "Unhappy with support quality",
    question: customerSignal(
      "does the customer say that the help from BMC support is poor, unhelpful, or not addressing their actual problem?",
      "The customer criticizes the quality or relevance of the help they received from BMC support.",
      "The customer does not criticize the help they received.",
    ),
  },
  relationshipRisk: {
    label: "Threatens relationship consequences",
    question: customerSignal(
      "does the customer mention consequences for their relationship with BMC, such as complaining to executives, reconsidering their contract or renewal, or replacing Control-M?",
      "The customer mentions executive complaints, contract or renewal risk, or moving away from Control-M or BMC.",
      "No relationship consequences are mentioned.",
    ),
  },
  engineerReportsUnhappy: {
    label: "Engineer notes say customer is unhappy",
    question: noul(
      "Do `bmc_engineer_notes` say that the customer is unhappy, frustrated, upset, escalating, or dissatisfied?",
      {
        true: "A BMC engineer's note reports that the customer is unhappy, frustrated, upset, escalating, or dissatisfied.",
        false: "The notes only describe technical work, calls, or next steps, or there are no notes.",
      },
    ),
  },
} as const;

export type SignalId = keyof typeof SIGNALS;

const CONTEXT = {
  businessImpact: {
    label: "Serious business impact",
    question: customerSignal(
      "does the customer describe serious business impact, such as a production outage, missed batch deadlines or SLAs, or pressure from their own management?",
      "The customer describes a production outage, missed deadlines or SLAs, or management pressure.",
      "No serious business impact is described.",
    ),
  },
} as const;

export const MOOD_LEVELS = [
  "Satisfied or appreciative: thanks BMC, confirms a fix worked, or agrees to close the case.",
  "Neutral: businesslike questions, answers, or information with no emotional tone.",
  "Mildly concerned or impatient: asks for faster progress or shows some worry, but stays calm.",
  "Clearly frustrated or dissatisfied: complains about the product, the delay, or the support received.",
  "Angry or escalating: strong language, demands escalation, or threatens consequences.",
] as const;

export const MOOD_LABELS = ["Satisfied", "Neutral", "Impatient", "Frustrated", "Angry"] as const;

function buildQuestions(state: SentimentState): Questions {
  const hasCustomer = state.customer_messages.length > 0;
  const hasNotes = state.bmc_engineer_notes.length > 0;
  const questions: Record<string, Question> = {};

  for (const [id, signal] of Object.entries(SIGNALS)) {
    const appliesToNotes = id === "engineerReportsUnhappy";
    if (appliesToNotes ? hasNotes : hasCustomer) questions[id] = signal.question;
  }
  if (hasCustomer) {
    questions.businessImpact = CONTEXT.businessImpact.question;
    questions.currentMood = score(
      "Based on the most recent entries at the end of `customer_messages`, how does the customer currently feel about how their case is going?",
      [...MOOD_LEVELS],
    );
  }

  const evidenceOptions: Record<string, string> = {};
  for (const m of state.customer_messages) evidenceOptions[m.id] = `The \`customer_messages\` entry with id "${m.id}".`;
  for (const n of state.bmc_engineer_notes) evidenceOptions[n.id] = `The \`bmc_engineer_notes\` entry with id "${n.id}".`;
  evidenceOptions.none = "No entry shows that the customer is upset or dissatisfied.";
  questions.evidence = choice(
    "Which single entry in `customer_messages` or `bmc_engineer_notes` most clearly shows that the customer is upset or dissatisfied?",
    evidenceOptions,
  );

  for (const m of state.customer_messages) {
    questions[`concern_${m.id}`] = noul(
      {
        question: `Does the \`customer_messages\` entry with id "${m.id}" show that the customer is upset, frustrated, or dissatisfied with their case or with BMC support?`,
        note: CUSTOMER_OWN_WORDS,
      },
      {
        true: "In that entry the customer complains, shows frustration or impatience, asks to escalate, or criticizes the help received.",
        false: "That entry is neutral, businesslike, polite, or appreciative, including plain technical updates and questions.",
      },
    );
  }
  for (const n of state.bmc_engineer_notes) {
    questions[`concern_${n.id}`] = noul(
      `Does the \`bmc_engineer_notes\` entry with id "${n.id}" report that the customer is upset, frustrated, escalating, or dissatisfied?`,
      {
        true: "That note reports the customer is upset, frustrated, escalating, or dissatisfied.",
        false: "That note only describes technical work, calls, or next steps.",
      },
    );
  }
  return questions;
}

export type JevAnswers = {
  model: string;
  inputTokens: number;
  signals: Record<SignalId, number>;
  businessImpact: number;
  mood: { score: number; confidence: number } | null;
  evidence: { id: string; probability: number; confidence: number } | null;
  /** Per-entry probability that the message shows (or a note reports) an upset customer, keyed by state id. */
  itemConcern: Record<string, number>;
};

let client: TypeSafeClient | null = null;

export function getClient(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    throw new Error("TYPESAFE_API_KEY is not set. Add it to the .env file in the project root.");
  }
  client ??= new TypeSafeClient({ defaultModel: config.jevModel, timeout: 30_000, retry: { maxRetries: 4 } });
  return client;
}

type AnyAnswer = NoulResponse | ChoiceResponse | ScoreResponse;

export async function askJev(state: SentimentState): Promise<JevAnswers> {
  const questions = buildQuestions(state);
  const result = await getClient().systemOne({ state, questions });
  const answers = result.answers as Record<string, AnyAnswer | undefined>;

  const noulOf = (id: string) => {
    const a = answers[id];
    return a?.type === "noul" ? a.noul : 0;
  };
  const signals = Object.fromEntries(
    (Object.keys(SIGNALS) as SignalId[]).map((id) => [id, noulOf(id)]),
  ) as Record<SignalId, number>;

  const mood = answers.currentMood;
  const evidence = answers.evidence;
  return {
    model: result.model,
    inputTokens: result.usage.input_tokens,
    signals,
    businessImpact: noulOf("businessImpact"),
    mood: mood?.type === "score" ? { score: mood.score, confidence: mood.confidence } : null,
    evidence:
      evidence?.type !== "choice" || evidence.choice === "none"
        ? null
        : {
            id: evidence.choice,
            probability: (evidence.probabilities as Record<string, number>)[evidence.choice] ?? 0,
            confidence: evidence.confidence,
          },
    itemConcern: Object.fromEntries(
      [...state.customer_messages, ...state.bmc_engineer_notes].map((entry) => [entry.id, noulOf(`concern_${entry.id}`)]),
    ),
  };
}

export const CONTEXT_LABELS = { businessImpact: CONTEXT.businessImpact.label };
