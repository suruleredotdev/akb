import { registerFrame } from './registry';
import { SemanticFrame } from './SemanticFrame';
import { MapFrame } from './MapFrame';
import { TimelineFrame } from './TimelineFrame';
import { ChartFrame } from './ChartFrame';
import { TextFrame } from './TextFrame';
import { GraphFrame } from './GraphFrame';

registerFrame('semantic', SemanticFrame);
registerFrame('map', MapFrame);
registerFrame('timeline', TimelineFrame);
registerFrame('chart', ChartFrame);
registerFrame('text', TextFrame);
registerFrame('graph', GraphFrame);
