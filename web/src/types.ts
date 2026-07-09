export type AcademicLevel = "Bachelor" | "Master" | "PhD";

export interface ChatMessage {
  id: string;
  role: "user" | "model" | "system";
  text: string;
  timestamp: Date;
}

export interface PracticeProblem {
  id: string;
  problem: string;
  hint: string;
  formulas: string;
  solution: string;
  revealed?: boolean;
  userAnswer?: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface QuizSession {
  topic: string;
  difficulty: string;
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswers: { [key: number]: number };
  completed: boolean;
  score?: number;
  timestamp: Date;
}

export interface SavedNote {
  id: string;
  type: "concept" | "problem" | "mission" | "calculation";
  title: string;
  content: string;
  timestamp: Date;
}

export interface SpaceMission {
  name: string;
  objectives: string;
  orbit: string;
  challenges: string;
  discoveries: string;
  links: string;
}

export interface ResearchPaper {
  id: string;
  title: string;
  authors: string;
  abstract?: string;
  equations?: string;
  methodology?: string;
  findings?: string;
  contentSnippet: string;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  imageUrl: string;
  model: string;
  size: string;
  aspectRatio: string;
  info?: string;
  timestamp: Date;
}

export interface StudentStats {
  queriesRun: number;
  problemsSolved: number;
  calculatorsUsed: number;
  quizzesTaken: number;
  avgQuizScore: number;
  topicsExplored: string[];
  recentActivity: {
    id: string;
    type: "chat" | "problem" | "calculator" | "quiz" | "image";
    description: string;
    timestamp: Date;
  }[];
}
