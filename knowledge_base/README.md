# Knowledge Base Workspace

Этот каталог хранит исходные правила оценки, из которых собирается system prompt.

## Как читать

1. [profiles/incidents.json](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/profiles/incidents.json)
   Показывает состав команды и порядок файлов.
2. [_CORE_instruction.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/_CORE_instruction.md)
   Хранит универсальный контракт ответа.
3. [abbr.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/abbr.md)
   Общие сокращения.
4. [incident_classification.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/incident_classification.md)
   Специфика классификации для incidents.
5. Нужные indicator files из `soft_skills/` и `hard_skills/`.

## Правила сортировки

- универсальные правила живут в `_CORE_instruction.md`;
- частная логика индикаторов живет только в indicator files;
- profile json определяет состав набора, а код — канонический порядок сборки;
- один индикатор = один файл;
- если правило относится только к одному индикатору, оно не должно дублироваться в core.

## Где смотреть связанный runtime

- KB assembly reference: [docs/details/09_knowledge_base.md](/Users/denis/Desktop/ETG/AgentAssistant/docs/details/09_knowledge_base.md)
- loader/runtime contract: [src/lib/kb_contract.js](/Users/denis/Desktop/ETG/AgentAssistant/src/lib/kb_contract.js)
- release loader: [src/lib/kb_loader.js](/Users/denis/Desktop/ETG/AgentAssistant/src/lib/kb_loader.js)
