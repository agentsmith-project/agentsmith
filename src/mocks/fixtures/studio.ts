/**
 * AI Studio Fixtures
 *
 * Mock agent thread, turn, source file, and recipe data for development and testing.
 */

import type { AgentThread, Turn, TurnEvent } from '@/lib/api/types';
import type { Recipe, RecipeMessage, Artifact } from '@/lib/types/recipe';

export interface SourceFile {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: 'ready' | 'processing' | 'failed' | 'attached';
  created_at: string;
  updated_at: string;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export const sourceFileFixtures: SourceFile[] = [
  {
    id: 'src_001',
    project_id: 'proj_001',
    file_name: 'product-specs.pdf',
    file_type: 'application/pdf',
    file_size: 456000,
    status: 'ready',
    created_at: '2026-01-28T09:00:00Z',
    updated_at: '2026-01-28T09:05:00Z',
  },
  {
    id: 'src_002',
    project_id: 'proj_001',
    file_name: 'user-guide.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 128000,
    status: 'ready',
    created_at: '2026-01-28T09:15:00Z',
    updated_at: '2026-01-28T09:18:00Z',
  },
  {
    id: 'src_003',
    project_id: 'proj_001',
    file_name: 'api-reference.md',
    file_type: 'text/markdown',
    file_size: 45000,
    status: 'ready',
    created_at: '2026-01-28T09:30:00Z',
    updated_at: '2026-01-28T09:31:00Z',
  },
  {
    id: 'src_004',
    project_id: 'proj_001',
    file_name: 'large-dataset.csv',
    file_type: 'text/csv',
    file_size: 5678000,
    status: 'processing',
    created_at: '2026-01-28T10:00:00Z',
    updated_at: '2026-01-28T10:05:00Z',
  },
  {
    id: 'src_005',
    project_id: 'proj_001',
    file_name: 'corrupted-file.pdf',
    file_type: 'application/pdf',
    file_size: 12000,
    status: 'failed',
    created_at: '2026-01-28T10:10:00Z',
    updated_at: '2026-01-28T10:12:00Z',
    error_message: 'Failed to extract text from PDF file',
  },
  {
    id: 'src_006',
    project_id: 'proj_001',
    file_name: 'meeting-notes.txt',
    file_type: 'text/plain',
    file_size: 8500,
    status: 'attached',
    created_at: '2026-01-28T08:00:00Z',
    updated_at: '2026-01-28T09:45:00Z',
  },
];

export const agentThreadFixtures: AgentThread[] = [
  {
    id: 'thread_001',
    project_id: 'proj_001',
    end_user_id: 'usr-***ext001',
    current_agent_id: 'agent_001',
    title: 'Product Information Request',
    status: 'active',
    created_at: '2026-01-28T10:00:00Z',
    updated_at: '2026-01-28T14:30:00Z',
  },
  {
    id: 'thread_002',
    project_id: 'proj_001',
    end_user_id: 'usr-***ext002',
    current_agent_id: 'agent_002',
    title: 'Technical Support',
    status: 'active',
    created_at: '2026-01-28T11:15:00Z',
    updated_at: '2026-01-28T13:45:00Z',
  },
  {
    id: 'thread_003',
    project_id: 'proj_001',
    end_user_id: 'usr-***ext003',
    current_agent_id: 'agent_001',
    title: 'Sales Inquiry',
    status: 'closed',
    created_at: '2026-01-27T16:00:00Z',
    updated_at: '2026-01-27T18:30:00Z',
  },
  {
    id: 'thread_004',
    project_id: 'proj_002',
    end_user_id: 'usr-***ext004',
    current_agent_id: 'agent_004',
    title: 'Data Analysis Request',
    status: 'active',
    created_at: '2026-01-28T09:00:00Z',
    updated_at: '2026-01-28T12:00:00Z',
  },
];

export const turnFixtures: Turn[] = [
  {
    id: 'turn_001',
    agent_thread_id: 'thread_001',
    status: 'completed',
    input_message: 'What are the key features of your product?',
    output_message: 'Our product offers several key features:\n\n1. **AI-Powered Automation**: Automate complex workflows with intelligent agents\n2. **Real-Time Collaboration**: Work together seamlessly with your team\n3. **Advanced Analytics**: Gain insights with comprehensive data analysis\n4. **Secure by Design**: Enterprise-grade security and compliance\n\nWould you like me to elaborate on any of these features?',
    created_at: '2026-01-28T10:05:00Z',
    updated_at: '2026-01-28T10:08:00Z',
    completed_at: '2026-01-28T10:08:00Z',
  },
  {
    id: 'turn_002',
    agent_thread_id: 'thread_001',
    status: 'completed',
    input_message: 'Tell me more about the AI automation',
    output_message: 'Our AI automation capabilities include:\n\n- **Natural Language Processing**: Understand and process human language\n- **Machine Learning**: Learn from data to improve performance\n- **Predictive Analytics**: Anticipate user needs and behaviors\n- **Intelligent Routing**: Automatically route tasks to the best resource\n\nThe system uses state-of-the-art transformer models and can be customized for your specific use case.',
    created_at: '2026-01-28T10:10:00Z',
    updated_at: '2026-01-28T10:15:00Z',
    completed_at: '2026-01-28T10:15:00Z',
  },
  {
    id: 'turn_003',
    agent_thread_id: 'thread_001',
    status: 'started',
    input_message: 'Can you help me set up a workflow?',
    output_message: undefined,
    created_at: '2026-01-28T14:25:00Z',
    updated_at: '2026-01-28T14:26:00Z',
  },
  {
    id: 'turn_004',
    agent_thread_id: 'thread_002',
    status: 'queued',
    input_message: 'I\'m having trouble with my account',
    created_at: '2026-01-28T13:40:00Z',
    updated_at: '2026-01-28T13:40:00Z',
  },
  {
    id: 'turn_005',
    agent_thread_id: 'thread_002',
    status: 'completed',
    input_message: 'How do I reset my password?',
    output_message: 'To reset your password:\n\n1. Go to the login page\n2. Click "Forgot Password"\n3. Enter your email address\n4. Check your email for reset instructions\n5. Follow the link and create a new password\n\nIf you don\'t receive the email within 5 minutes, please check your spam folder or contact support.',
    created_at: '2026-01-28T11:20:00Z',
    updated_at: '2026-01-28T11:22:00Z',
    completed_at: '2026-01-28T11:22:00Z',
  },
  {
    id: 'turn_006',
    agent_thread_id: 'thread_003',
    status: 'failed',
    input_message: 'Generate a sales report',
    output_message: undefined,
    error_code: 'AGENT_TIMEOUT',
    error_message: 'Agent did not respond within the timeout period',
    created_at: '2026-01-27T17:45:00Z',
    updated_at: '2026-01-27T17:50:00Z',
    completed_at: '2026-01-27T17:50:00Z',
  },
];

export const turnEventFixtures: TurnEvent[] = [
  {
    id: 'evt_001',
    turn_id: 'turn_001',
    event_type: 'turn.queued',
    data: { timestamp: '2026-01-28T10:05:00Z' },
    timestamp: '2026-01-28T10:05:00Z',
  },
  {
    id: 'evt_002',
    turn_id: 'turn_001',
    event_type: 'turn.started',
    data: { agent_id: 'agent_001' },
    timestamp: '2026-01-28T10:05:05Z',
  },
  {
    id: 'evt_003',
    turn_id: 'turn_001',
    event_type: 'agent.message',
    data: {
      content: 'Our product offers several key features...',
      delta: true,
    },
    timestamp: '2026-01-28T10:06:00Z',
  },
  {
    id: 'evt_004',
    turn_id: 'turn_001',
    event_type: 'turn.completed',
    data: {
      output_message: 'Our product offers several key features...\n\nWould you like me to elaborate on any of these features?',
      tokens_used: 156,
      duration_ms: 1800,
    },
    timestamp: '2026-01-28T10:08:00Z',
  },
  {
    id: 'evt_005',
    turn_id: 'turn_003',
    event_type: 'turn.queued',
    data: { timestamp: '2026-01-28T14:25:00Z' },
    timestamp: '2026-01-28T14:25:00Z',
  },
  {
    id: 'evt_006',
    turn_id: 'turn_003',
    event_type: 'turn.started',
    data: { agent_id: 'agent_001' },
    timestamp: '2026-01-28T14:25:05Z',
  },
  {
    id: 'evt_007',
    turn_id: 'turn_003',
    event_type: 'source.attached',
    data: {
      source_files: ['src_001', 'src_002'],
      count: 2,
    },
    timestamp: '2026-01-28T14:25:10Z',
  },
  {
    id: 'evt_008',
    turn_id: 'turn_006',
    event_type: 'turn.queued',
    data: { timestamp: '2026-01-27T17:45:00Z' },
    timestamp: '2026-01-27T17:45:00Z',
  },
  {
    id: 'evt_009',
    turn_id: 'turn_006',
    event_type: 'turn.started',
    data: { agent_id: 'agent_001' },
    timestamp: '2026-01-27T17:45:05Z',
  },
  {
    id: 'evt_010',
    turn_id: 'turn_006',
    event_type: 'turn.failed',
    data: {
      error_code: 'AGENT_TIMEOUT',
      error_message: 'Agent did not respond within the timeout period',
    },
    timestamp: '2026-01-27T17:50:00Z',
  },
];

// ============================================================
// Recipe Fixtures
// ============================================================

export const recipeFixtures: Recipe[] = [
  {
    id: 'recipe_001',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    owner_user_id: 'user_001',
    title: 'Product Documentation Analysis',
    agent_id: 'agent_001',
    agent_name: 'AgentA',
    status: 'active',
    attached_source_ids: ['src_001', 'src_002'],
    created_at: '2026-01-28T10:00:00Z',
    updated_at: '2026-01-28T14:30:00Z',
    last_activity_at: '2026-01-28T14:30:00Z',
  },
  {
    id: 'recipe_002',
    workspace_id: 'ws_001',
    project_id: 'proj_001',
    owner_user_id: 'user_001',
    title: 'API Reference Guide',
    agent_id: 'agent_002',
    agent_name: 'AgentB',
    status: 'active',
    attached_source_ids: ['src_003'],
    created_at: '2026-01-28T11:15:00Z',
    updated_at: '2026-01-28T13:45:00Z',
    last_activity_at: '2026-01-28T13:45:00Z',
  },
];

export const recipeMessageFixtures: RecipeMessage[] = [
  {
    id: 'msg_recipe_001_001',
    recipe_id: 'recipe_001',
    role: 'user',
    content: 'Analyze the product specifications and create a summary',
    created_at: '2026-01-28T10:05:00Z',
    referenced_source_ids: ['src_001'],
  },
  {
    id: 'msg_recipe_001_002',
    recipe_id: 'recipe_001',
    role: 'agent',
    content: 'Based on the product specifications document, here is a comprehensive summary:\n\n**Key Features:**\n- Advanced AI capabilities\n- Real-time processing\n- Scalable architecture\n\n**Technical Specifications:**\n- Supports multiple data formats\n- High-performance processing engine\n- Enterprise-grade security',
    created_at: '2026-01-28T10:08:00Z',
    referenced_source_ids: ['src_001'],
  },
  {
    id: 'msg_recipe_001_003',
    recipe_id: 'recipe_001',
    role: 'user',
    content: 'Can you create a visual diagram of the architecture?',
    created_at: '2026-01-28T10:15:00Z',
  },
  {
    id: 'msg_recipe_002_001',
    recipe_id: 'recipe_002',
    role: 'user',
    content: 'Generate API documentation from the reference file',
    created_at: '2026-01-28T11:20:00Z',
    referenced_source_ids: ['src_003'],
  },
];

export const artifactFixtures: Artifact[] = [
  {
    id: 'art_001',
    recipe_id: 'recipe_001',
    turn_id: 'turn_001',
    type: 'text',
    title: 'Product Summary',
    content: '**Product Summary**\n\nKey features and technical specifications extracted from the product documentation...',
    created_at: '2026-01-28T10:08:00Z',
  },
  {
    id: 'art_002',
    recipe_id: 'recipe_001',
    turn_id: 'turn_001',
    type: 'image',
    title: 'Architecture Diagram',
    content: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="100%25" height="100%25" fill="%23e5e7eb"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%236b7280" font-size="12">Diagram</text></svg>',
    thumbnail_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="100%25" height="100%25" fill="%23e5e7eb"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%236b7280" font-size="10">Diagram</text></svg>',
    created_at: '2026-01-28T10:20:00Z',
  },
];
