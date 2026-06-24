import { registerFrame } from './registry';
import { SemanticFrame } from './SemanticFrame';
import { MapFrame } from './MapFrame';
import { TimelineFrame } from './TimelineFrame';
import { ChartFrame } from './ChartFrame';
import { TextFrame } from './TextFrame';
import { GraphFrame } from './GraphFrame';
import { SummaryFrame } from './SummaryFrame';
import { LLMFrame } from './LLMFrame';
import { FilterFrame } from './FilterFrame';

// Activate history tracking (subscribes to selectionStore)
import '../state/history-store';

registerFrame('semantic', SemanticFrame);
registerFrame('map', MapFrame);
registerFrame('timeline', TimelineFrame);
registerFrame('chart', ChartFrame);
registerFrame('text', TextFrame);
registerFrame('graph', GraphFrame);
registerFrame('summary', SummaryFrame);
registerFrame('llm', LLMFrame);
registerFrame('filter', FilterFrame);
