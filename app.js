// Variáveis Globais de Controle de Dados
let dadosOriginais = [];
let dadosProcessados = [];
let dadosFiltrados = [];
let listaDatasDisponiveis = [];

// Ordenação
let colunaOrdenada = '';
let ordemAscendente = true;

// Paginação
let paginaAtual = 1;
let linhasPorPagina = 10;

// Registrar o plugin ChartDataLabels globalmente
Chart.register(ChartDataLabels);

// Instâncias Globais de Gráficos
let charts = {
    empresa: null,
    segmento: null,
    veiculo: null,
    equipamento: null,
    faixaHoraria: null
};

// Dicionário de Categoria de Segmentos por Empresa
const segmentosEmpresa = {
    "AVUL": [
        "Urubupungá",
        "Urubupungá Municipal Cajamar",
        "Urubupungá Municipal Osasco",
        "Urubupungá Municipal Santana"
    ],
    "VCCL": [
        "Cidade de Caieiras - Municipal Caieiras",
        "Cidade de Caieiras - Municipal Franco da Rocha",
        "Viação Cidade Caieiras"
    ]
};

// =====================================================================
//           FUNÇÕES DE PERSISTÊNCIA E TIMELINE DA MANUTENÇÃO
// =====================================================================

function obterFichasManutencao() {
    return JSON.parse(localStorage.getItem('manutencao_fichas') || '[]');
}

def_salvar = function(fichas) {
    localStorage.setItem('manutencao_fichas', JSON.stringify(fichas));
}

function converterParaDataObjeto(dataStr, horaStr) {
    if (!dataStr) return new Date(0);
    const partesD = dataStr.split("/");
    const dia = parseInt(partesD[0]);
    const mes = parseInt(partesD[1]) - 1;
    const ano = parseInt(partesD[2]);
    
    let hora = 0;
    if (horaStr) {
        hora = parseInt(horaStr.replace("h", ""));
    }
    return new Date(ano, mes, dia, hora, 0, 0);
}

function resolverEstadoFicha(veiculo, dataLinha, horaLinha) {
    const fichas = obterFichasManutencao();
    const tLinha = converterParaDataObjeto(dataLinha, horaLinha);
    
    const fichasVeiculo = fichas.filter(f => f.veiculo === veiculo);
    if (fichasVeiculo.length === 0) {
        return { estado: 'Sem Ficha', ticket: null, index: -1 };
    }
    
    // 1. Procura se o veículo possui alguma ficha aberta no momento desta linha
    for (let i = 0; i < fichas.length; i++) {
        const f = fichas[i];
        if (f.veiculo !== veiculo) continue;
        
        const tAbertura = converterParaDataObjeto(f.data_abertura, f.hora_abertura);
        const tFechamento = f.data_fechamento ? converterParaDataObjeto(f.data_fechamento, f.hora_fechamento) : null;
        
        if (tLinha >= tAbertura) {
            if (!tFechamento || tLinha < tFechamento) {
                return { estado: 'Aberta', ticket: f, index: i };
            }
        }
    }
    
    // 2. Se não está aberta, verifica se há alguma ficha que já foi fechada antes desta linha
    let ultimaFechada = null;
    let indexFechada = -1;
    for (let i = 0; i < fichas.length; i++) {
        const f = fichas[i];
        if (f.veiculo !== veiculo) continue;
        
        const tFechamento = f.data_fechamento ? converterParaDataObjeto(f.data_fechamento, f.hora_fechamento) : null;
        if (tFechamento && tLinha >= tFechamento) {
            if (!ultimaFechada || tFechamento > converterParaDataObjeto(ultimaFechada.data_fechamento, ultimaFechada.hora_fechamento)) {
                ultimaFechada = f;
                indexFechada = i;
            }
        }
    }
    
    if (ultimaFechada) {
        return { estado: 'Fechada', ticket: ultimaFechada, index: indexFechada };
    }
    
    return { estado: 'Sem Ficha', ticket: null, index: -1 };
}

// Inicialização da Página (DOMContentLoaded)
document.addEventListener('DOMContentLoaded', () => {
    inicializarTema();
    limparFichasAntigas(); // Expurgo de registros antigos locais superiores a 7 dias

    // Evento de mudança dinâmico na seleção do filtro de data
    document.getElementById('filtro-data').addEventListener('change', (e) => {
        const dataSelecionada = e.target.value;
        carregarDados(dataSelecionada); // Busca assíncrona do respectivo JSON histórico fragmentado
    });

    // Eventos Gerais
    document.getElementById('btn-atualizar').addEventListener('click', () => {
        const dataSelecionada = document.getElementById('filtro-data').value;
        carregarDados(dataSelecionada);
    });
    document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);
    document.getElementById('input-linhas-pagina').addEventListener('input', mudarLinhasPorPagina);
    document.getElementById('btn-tema').addEventListener('click', alternarTema);
    document.getElementById('btn-fullscreen').addEventListener('click', alternarFullscreen);

    // Eventos de mudança nos filtros
    const filtrosId = [
        'filtro-hora', 'filtro-empresa', 'filtro-segmento',
        'filtro-condicao', 'filtro-situacao', 'filtro-equipamento', 'filtro-status', 
        'filtro-nao-conformidade', 'filtro-status-gps', 'filtro-integracao'
    ];
    filtrosId.forEach(id => {
        document.getElementById(id).addEventListener('change', aplicarFiltros);
    });
    
    // Filtros de Digitação (Linha e Veículo possuem comportamento imediato de input)
    document.getElementById('filtro-linha').addEventListener('input', aplicarFiltros);
    document.getElementById('filtro-veiculo').addEventListener('input', aplicarFiltros);

    // Eventos de navegação da tabela
    document.getElementById('pag-anterior').addEventListener('click', () => navegarPagina(-1));
    document.getElementById('pag-proximo').addEventListener('click', () => navegarPagina(1));

    // Eventos de cliques nos cabeçalhos da tabela para Ordenação
    document.querySelectorAll('#tabela-analise th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            ordenarTabelaPor(th.getAttribute('data-sort'));
        });
    });

    // Carga inicial estruturada de dados
    inicializarDadosEstruturados();
});

// Registra escutas de evento de mudança de tela cheia para todos os navegadores
const eventosFullscreen = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
eventosFullscreen.forEach(evento => {
    document.addEventListener(evento, sincronizarIconeFullscreen);
});

// Inicialização de Tema (Salvo em cache)
function inicializarTema() {
    const temaSalvo = localStorage.getItem('theme') || 'light';
    const body = document.body;
    const icon = document.getElementById('icon-tema');
    
    if (temaSalvo === 'dark') {
        body.classList.add('dark');
        icon.className = 'fa-solid fa-sun text-lg text-amber-400';
    } else {
        body.classList.remove('dark');
        icon.className = 'fa-solid fa-moon text-lg text-slate-300';
    }
}

// Alterna o Tema entre Light/Dark
function alternarTema() {
    const body = document.body;
    const icon = document.getElementById('icon-tema');
    
    if (body.classList.contains('dark')) {
        body.classList.remove('dark');
        icon.className = 'fa-solid fa-moon text-lg text-slate-300';
        localStorage.setItem('theme', 'light');
    } else {
        body.classList.add('dark');
        icon.className = 'fa-solid fa-sun text-lg text-amber-400';
        localStorage.setItem('theme', 'dark');
    }
    atualizarGraficos();
}

// Ativa ou desativa o modo Tela Cheia com suporte a múltiplos navegadores
function alternarFullscreen() {
    const docEl = document.documentElement;
    const isFullscreen = document.fullscreenElement || 
                         document.webkitFullscreenElement || 
                         document.mozFullScreenElement || 
                         document.msFullscreenElement;

    if (!isFullscreen) {
        const requestFS = docEl.requestFullscreen || 
                          docEl.webkitRequestFullscreen || 
                          docEl.mozRequestFullScreen || 
                          docEl.msRequestFullscreen;
        if (requestFS) {
            requestFS.call(docEl).catch(err => {
                console.error(`Erro ao ativar tela cheia: ${err.message}`);
            });
        }
    } else {
        const exitFS = document.exitFullscreen || 
                       document.webkitExitFullscreen || 
                       document.mozCancelFullScreen || 
                       document.msExitFullscreen;
        if (exitFS) {
            exitFS.call(document);
        }
    }
}

// Sincroniza o ícone de expansão/compressão em múltiplos navegadores
function sincronizarIconeFullscreen() {
    const icon = document.getElementById('icon-fullscreen');
    if (!icon) return;
    
    const isFullscreen = document.fullscreenElement || 
                         document.webkitFullscreenElement || 
                         document.mozFullScreenElement || 
                         document.msFullscreenElement;
                         
    if (isFullscreen) {
        icon.className = 'fa-solid fa-compress text-sm';
    } else {
        icon.className = 'fa-solid fa-expand text-sm';
    }
}

// Limpeza automática de chaves com mais de 7 dias do histórico estruturado
function limparFichasAntigas() {
    const hoje = new Date();
    const seteDiasEmMs = 7 * 24 * 60 * 60 * 1000;
    const fichas = obterFichasManutencao();
    
    const filtradas = fichas.filter(f => {
        if (!f.data_fechamento) return true; // Mantém aberta indefinidamente
        const tFechamento = converterParaDataObjeto(f.data_fechamento, f.hora_fechamento);
        return (hoje - tFechamento) <= seteDiasEmMs;
    });
    
    def_salvar(filtradas);
}

// Carga inicial estruturada (Data Index -> Dados Atuais)
function inicializarDadosEstruturados() {
    fetch('datas.json')
        .then(response => {
            if (!response.ok) throw new Error('Falha ao carregar datas.json');
            return response.json();
        })
        .then(datas => {
            listaDatasDisponiveis = datas;
            const selectData = document.getElementById('filtro-data');
            
            // Popula as opções do filtro de data baseado no índice histórico
            selectData.innerHTML = '';
            listaDatasDisponiveis.forEach(d => {
                selectData.innerHTML += `<option value="${d}">${d}</option>`;
            });
            
            // Seleciona por padrão o dia operacional mais recente (última posição do vetor)
            if (listaDatasDisponiveis.length > 0) {
                selectData.value = listaDatasDisponiveis[listaDatasDisponiveis.length - 1];
            }
            
            // Carrega os dados referentes à data selecionada
            carregarDados(selectData.value);
        })
        .catch(erro => {
            console.warn('datas.json não disponível, recorrendo ao carregamento padrão:', erro);
            carregarDados();
        });
}

// Busca as informações do JSON dinamicamente
function carregarDados(dataEspecifica = null) {
    const btn = document.getElementById('btn-atualizar');
    const icon = document.getElementById('icon-reload');
    
    icon.classList.add('rotate-anim');
    btn.disabled = true;

    // Define qual arquivo de dados buscar com base na seleção
    const arquivo = dataEspecifica ? `dados-${dataEspecifica.replace(/\//g, '-')}.json` : 'dados.json';

    fetch(arquivo)
        .then(response => {
            if (!response.ok) throw new Error('Falha ao carregar dados do arquivo: ' + arquivo);
            return response.json();
        })
        .then(dados => {
            dadosOriginais = dados;
            processarDadosGerais();
            preencherOpcoesFiltros(!!dataEspecifica);
            
            if (!dataEspecifica) {
                configurarFiltrosIniciais(); 
            } else {
                atualizarOpcoesHora();
                const selectHora = document.getElementById('filtro-hora');
                const opcoesHora = Array.from(selectHora.options).map(o => o.value).filter(Boolean);
                if (opcoesHora.length > 0) {
                    selectHora.value = opcoesHora[opcoesHora.length - 1];
                }
            }
            
            aplicarFiltros();
            
            const agora = new Date();
            const formatado = `${agora.getDate().toString().padStart(2, '0')}/${(agora.getMonth() + 1).toString().padStart(2, '0')}/${agora.getFullYear()} às ${agora.getHours().toString().padStart(2, '0')}h${agora.getMinutes().toString().padStart(2, '0')}`;
            document.getElementById('txt-atualizado-em').innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500 mr-1 flex-shrink-0"></i> Atualizado em ${formatado}`;
        })
        .catch(erro => {
            console.error('Erro na leitura dos dados:', erro);
            document.getElementById('txt-atualizado-em').innerHTML = `<i class="fa-solid fa-circle-xmark text-rose-500 mr-1"></i> Erro ao carregar dados`;
        })
        .finally(() => {
            icon.classList.remove('rotate-anim');
            btn.disabled = false;
        });
}

// Higieniza e padroniza as colunas de dados
function processarDadosGerais() {
    let maiorDataObj = null;
    let dataReferenciaStr = ""; 
    let horaReferenciaStr = "";

    dadosOriginais.forEach(item => {
        const campoData = item["Última Transmissão"] || item["Último GPS"];
        if (campoData && campoData !== "null") {
            const partes = campoData.split(" ");
            if (partes.length === 2) {
                const dPartes = partes[0].split("/");
                const tPartes = partes[1].split(":");
                
                let anoCompleto = parseInt(dPartes[2]);
                if (anoCompleto < 100) anoCompleto += 2000;

                const dObj = new Date(anoCompleto, dPartes[1] - 1, dPartes[0], tPartes[0], tPartes[1]);
                if (!maiorDataObj || dObj > maiorDataObj) {
                    maiorDataObj = dObj;
                    dataReferenciaStr = partes[0];
                    horaReferenciaStr = partes[1];
                }
            }
        }
    });

    if (!maiorDataObj) {
        const hoje = new Date();
        dataReferenciaStr = `${hoje.getDate().toString().padStart(2, '0')}/${(hoje.getMonth() + 1).toString().padStart(2, '0')}/${hoje.getFullYear()}`;
        horaReferenciaStr = `${hoje.getHours().toString().padStart(2, '0')}:${hoje.getMinutes().toString().padStart(2, '0')}`;
    }

    const dPartes = dataReferenciaStr.split("/");
    const exportDataFormatada = `${dPartes[0]}/${dPartes[1]}/${dPartes[2].length === 2 ? '20' + dPartes[2] : dPartes[2]}`; // dd/mm/aaaa
    const exportHoraFormatada = `${horaReferenciaStr.split(":")[0]}h`;

    dadosProcessados = dadosOriginais.map(item => {
        const segmentoOrigem = item["Empresa"] || "";
        let empresaGrupo = "";
        if (segmentosEmpresa["AVUL"].includes(segmentoOrigem)) {
            empresaGrupo = "AVUL";
        } else if (segmentosEmpresa["VCCL"].includes(segmentoOrigem)) {
            empresaGrupo = "VCCL";
        }

        const linhaOriginal = item["Linha"];
        let linhaPrefixo = "";
        if (linhaOriginal && linhaOriginal !== "null") {
            linhaPrefixo = linhaOriginal.split("-")[0].trim();
        }

        const prefixoOriginal = item["Prefixo"];
        let veiculoFormatado = "";
        if (prefixoOriginal !== null && prefixoOriginal !== undefined) {
            let str = prefixoOriginal.toString();
            if (str.length === 3) veiculoFormatado = "00" + str;
            else if (str.length === 4) veiculoFormatado = "0" + str;
            else veiculoFormatado = str;
        }

        const condicao = (linhaOriginal && linhaOriginal !== "null") ? "Escalado" : "Sem Escala";

        const ncOriginal = item["Não Conformidade"];
        let ncLimpa = "";
        if (ncOriginal && ncOriginal !== "null" && ncOriginal !== "") {
            let t = ncOriginal.toLowerCase();
            if (t.includes("sem transmissão") || t.includes("sem transmissao")) {
                ncLimpa = "Sem Transmissão";
            } else if (t.includes("sem gps válido") || t.includes("sem gps valido")) {
                ncLimpa = "Sem GPS Válido";
            } else if (t.includes("sem gps")) {
                ncLimpa = "Sem GPS";
            } else if (t.includes("sem avl")) {
                ncLimpa = "Sem AVL";
            } else if (t.includes("sem processar pontos de controle") || t.includes("pontos de controle")) {
                ncLimpa = "Sem Processar Pontos de Controle";
            } else if (t.includes("carga de ponto") || t.includes("problema de carga")) {
                ncLimpa = "Problema de Carga de Ponto";
            } else {
                let limpo = ncOriginal.replace(/^Ve[íi]culo\s+/i, "");
                limpo = limpo.replace(/\s+\d+h\d+min.*$/i, "");
                limpo = limpo.replace(/\s+\d+h.*$/i, "");
                limpo = limpo.replace(/gps/i, "GPS").replace(/avl/i, "AVL");
                ncLimpa = limpo.trim();
            }
        }

        const horaValidador = item["Hora estado validador"];
        let integracao = "";
        if (!horaValidador || horaValidador === "null") {
            integracao = "Sem Integração";
        } else {
            const partesV = horaValidador.split(" ");
            if (partesV.length === 2) {
                const dataV = partesV[0];
                const horaV = partesV[1].split(":")[0];
                const horaExp = horaReferenciaStr.split(":")[0];

                if (dataV === dataReferenciaStr) {
                    if (horaV !== horaExp) {
                        integracao = "Falha na Integração";
                    } else {
                        integracao = "Em Dia";
                    }
                } else {
                    integracao = "Falha na Integração";
                }
            }
        }

        const dataFinal = item["_data_pasta"] ? item["_data_pasta"] : exportDataFormatada;
        const horaFinal = item["_hora_pasta"] ? item["_hora_pasta"] : exportHoraFormatada;

        return {
            ...item,
            _dataExportacao: dataFinal,
            _horaExportacao: horaFinal,
            _empresaGrupo: empresaGrupo,
            _segmento: segmentoOrigem,
            _linhaPrefixo: linhaPrefixo,
            _veiculoFormatado: veiculoFormatado,
            _condicao: condicao,
            _naoConformidadeLimpa: ncLimpa,
            _integracao: integracao
        };
    });
}

// Popula os selects dos filtros
function preencherOpcoesFiltros(ignorarFiltroData = false) {
    const carregarOpcaoUnica = (id, campo) => {
        const select = document.getElementById(id);
        const valorSelecionado = select.value;
        select.innerHTML = '<option value="">Todos</option>';
        
        const valoresUnicos = [...new Set(dadosProcessados.map(d => d[campo]).filter(Boolean))].sort();
        valoresUnicos.forEach(v => {
            select.innerHTML += `<option value="${v}">${v}</option>`;
        });
        select.value = valorSelecionado;
    };

    if (!ignorarFiltroData) {
        const selectData = document.getElementById('filtro-data');
        const valorSelecionado = selectData.value;
        selectData.innerHTML = '';
        listaDatasDisponiveis.forEach(d => {
            selectData.innerHTML += `<option value="${d}">${d}</option>`;
        });
        selectData.value = valorSelecionado || (listaDatasDisponiveis.length > 0 ? listaDatasDisponiveis[listaDatasDisponiveis.length - 1] : "");
    }

    carregarOpcaoUnica('filtro-situacao', 'Situação');
    carregarOpcaoUnica('filtro-equipamento', 'Fab');
    carregarOpcaoUnica('filtro-status', 'Status');
    carregarOpcaoUnica('filtro-status-gps', 'Status GPS');
    
    const selectNC = document.getElementById('filtro-nao-conformidade');
    const ncSelecionado = selectNC.value;
    selectNC.innerHTML = '<option value="">Todas</option>';
    const ncsUnicas = [...new Set(dadosProcessados.map(d => d._naoConformidadeLimpa).filter(Boolean))].sort();
    ncsUnicas.forEach(v => {
        selectNC.innerHTML += `<option value="${v}">${v}</option>`;
    });
    selectNC.value = ncSelecionado;

    atualizarOpcoesSegmento();
}

// Configura filtros iniciais automáticos
function configurarFiltrosIniciais() {
    atualizarOpcoesSegmento();
    atualizarOpcoesHora();

    const selectHora = document.getElementById('filtro-hora');
    const opcoesHora = Array.from(selectHora.options).map(o => o.value).filter(Boolean);
    if (opcoesHora.length > 0) {
        opcoesHora.sort((a, b) => {
            const numA = parseInt(a.replace('h', ''));
            const numB = parseInt(b.replace('h', ''));
            return numA - numB;
        });
        selectHora.value = opcoesHora[opcoesHora.length - 1];
    }
}

// Atualiza segmentos baseado na Empresa
function atualizarOpcoesSegmento() {
    const selectEmpresa = document.getElementById('filtro-empresa');
    const selectSegmento = document.getElementById('filtro-segmento');
    const segmentoSelecionado = selectSegmento.value;
    
    selectSegmento.innerHTML = '<option value="">Todos</option>';
    
    let segmentosPermitidos = [];
    if (selectEmpresa.value === "AVUL") {
        segmentosPermitidos = segmentosEmpresa["AVUL"];
    } else if (selectEmpresa.value === "VCCL") {
        segmentosPermitidos = segmentosEmpresa["VCCL"];
    } else {
        segmentosPermitidos = [...segmentosEmpresa["AVUL"], ...segmentosEmpresa["VCCL"]];
    }
    
    segmentosPermitidos.sort().forEach(seg => {
        selectSegmento.innerHTML += `<option value="${seg}">${seg}</option>`;
    });

    if (segmentosPermitidos.includes(segmentoSelecionado)) {
        selectSegmento.value = segmentoSelecionado;
    } else {
        selectSegmento.value = "";
    }
}

// Limpa filtros
function limparFiltros() {
    document.getElementById('filtro-hora').value = "";
    document.getElementById('filtro-empresa').value = "";
    document.getElementById('filtro-segmento').value = "";
    document.getElementById('filtro-linha').value = ""; 
    document.getElementById('filtro-veiculo').value = "";
    document.getElementById('filtro-condicao').value = "";
    document.getElementById('filtro-situacao').value = "";
    document.getElementById('filtro-equipamento').value = "";
    document.getElementById('filtro-status').value = "";
    document.getElementById('filtro-nao-conformidade').value = "";
    document.getElementById('filtro-status-gps').value = "";
    document.getElementById('filtro-integracao').value = "";
    
    atualizarOpcoesSegmento();
    atualizarOpcoesHora();
    aplicarFiltros();
}

// Aplica filtros gerais
function aplicarFiltros() {
    const filtroEmpresa = document.getElementById('filtro-empresa').value;
    
    atualizarOpcoesSegmento();
    atualizarOpcoesHora();
    
    const filtros = {
        data: document.getElementById('filtro-data').value,
        hora: document.getElementById('filtro-hora').value,
        empresa: filtroEmpresa,
        segmento: document.getElementById('filtro-segmento').value,
        linha: document.getElementById('filtro-linha').value.trim(), 
        veiculo: document.getElementById('filtro-veiculo').value.trim(),
        condicao: document.getElementById('filtro-condicao').value,
        situacao: document.getElementById('filtro-situacao').value,
        equipamento: document.getElementById('filtro-equipamento').value,
        status: document.getElementById('filtro-status').value,
        naoConformidade: document.getElementById('filtro-nao-conformidade').value,
        statusGps: document.getElementById('filtro-status-gps').value,
        integracao: document.getElementById('filtro-integracao').value
    };

    dadosFiltrados = dadosProcessados.filter(item => {
        if (filtros.data && item._dataExportacao !== filtros.data) return false;
        if (filtros.hora && item._horaExportacao !== filtros.hora) return false;
        if (filtros.empresa && item._empresaGrupo !== filtros.empresa) return false;
        if (filtros.segmento && item._segmento !== filtros.segmento) return false;
        if (filtros.linha && !item._linhaPrefixo.includes(filtros.linha)) return false; 
        if (filtros.veiculo && !item._veiculoFormatado.includes(filtros.veiculo)) return false;
        if (filtros.condicao && item._condicao !== filtros.condicao) return false;
        if (filtros.situacao && item.Situação !== filtros.situacao) return false;
        if (filtros.equipamento && item.Fab !== filtros.equipamento) return false;
        if (filtros.status && item.Status !== filtros.status) return false;
        if (filtros.naoConformidade && item._naoConformidadeLimpa !== filtros.naoConformidade) return false;
        if (filtros.statusGps && item["Status GPS"] !== filtros.statusGps) return false;
        if (filtros.integracao && item._integracao !== filtros.integracao) return false;
        
        return true;
    });

    paginaAtual = 1;
    colunaOrdenada = ''; 
    atualizarKPIs();
    atualizarMiniCards();
    renderizarTabela();
    atualizarGraficos();
}

// Ordenação da Tabela por Coluna
function ordenarTabelaPor(coluna) {
    if (colunaOrdenada === coluna) {
        ordemAscendente = !ordemAscendente;
    } else {
        colunaOrdenada = coluna;
        ordemAscendente = true;
    }

    dadosFiltrados.sort((a, b) => {
        let valA = a[coluna];
        let valB = b[coluna];

        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';

        if (coluna === '_veiculoFormatado' || coluna === '_linhaPrefixo') {
            return ordemAscendente 
                ? valA.localeCompare(valB, undefined, {numeric: true, sensitivity: 'base'}) 
                : valB.localeCompare(valA, undefined, {numeric: true, sensitivity: 'base'});
        }

        valA = valA.toString().toLowerCase();
        valB = valB.toString().toLowerCase();

        if (valA < valB) return ordemAscendente ? -1 : 1;
        if (valA > valB) return ordemAscendente ? 1 : -1;
        return 0;
    });

    renderizarTabela();
    atualizarIconesOrdenacao();
}

// Atualiza os ícones de setas indicadoras de ordenação
function atualizarIconesOrdenacao() {
    document.querySelectorAll('#tabela-analise th[data-sort]').forEach(th => {
        const campo = th.getAttribute('data-sort');
        const icon = th.querySelector('i');
        if (!icon) return;

        if (campo === colunaOrdenada) {
            icon.className = ordemAscendente ? 'fa-solid fa-caret-up ml-1 text-emerald-500' : 'fa-solid fa-caret-down ml-1 text-emerald-500';
            icon.style.opacity = '1';
        } else {
            icon.className = 'fa-solid fa-sort ml-1';
            icon.style.opacity = '0.4';
        }
    });
}

// Atualiza KPIs
function atualizarKPIs() {
    const total = dadosFiltrados.length;
    const operando = dadosFiltrados.filter(d => d.Situação === "Operando").length;
    const manutencao = dadosFiltrados.filter(d => d.Situação === "Em Manutenção").length;
    const escalados = dadosFiltrados.filter(d => d._condicao === "Escalado").length;
    const semEscala = dadosFiltrados.filter(d => d._condicao === "Sem Escala").length;
    const gpsValido = dadosFiltrados.filter(d => d["Status GPS"] === "Válido").length;
    const gpsInvalido = total - gpsValido;
    const falhaIntegracao = dadosFiltrados.filter(d => d._integracao === "Falha na Integração").length;
    const semIntegracao = dadosFiltrados.filter(d => d._integracao === "Sem Integração").length;

    const fichasAbertas = dadosFiltrados.filter(item => {
        const res = resolverEstadoFicha(item._veiculoFormatado, item._dataExportacao, item._horaExportacao);
        return res.estado === 'Aberta';
    }).length;

    document.querySelectorAll('#kpi-total').forEach(el => el.textContent = total.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-operando').forEach(el => el.textContent = operando.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-manutencao').forEach(el => el.textContent = manutencao.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-escalados').forEach(el => el.textContent = escalados.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-sem-escala').forEach(el => el.textContent = semEscala.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-gps-valido').forEach(el => el.textContent = gpsValido.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-gps-invalido').forEach(el => el.textContent = gpsInvalido.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-falha-integracao').forEach(el => el.textContent = falhaIntegracao.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-sem-integracao').forEach(el => el.textContent = semIntegracao.toLocaleString('pt-BR'));
    document.querySelectorAll('#kpi-fichas-abertas').forEach(el => el.textContent = fichasAbertas.toLocaleString('pt-BR'));    
}

// Renderiza Linhas da Tabela
function renderizarTabela() {
    const corpo = document.getElementById('corpo-tabela');
    corpo.innerHTML = '';

    const totalRegistros = dadosFiltrados.length;
    const totalPaginas = Math.ceil(totalRegistros / linhasPorPagina) || 1;

    if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

    const inicio = (paginaAtual - 1) * linhasPorPagina;
    const fim = Math.min(inicio + linhasPorPagina, totalRegistros);
    const registrosPagina = dadosFiltrados.slice(inicio, fim);

    if (totalRegistros === 0) {
        corpo.innerHTML = '<tr><td colspan="13" class="p-6 text-center text-slate-500 font-medium bg-white dark:bg-slate-800">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
        document.getElementById('txt-total-registros').textContent = 'Exibindo 0 de 0 registros';
        document.getElementById('txt-pag-atual').textContent = 'Pág. 1 de 1';
        document.getElementById('pag-anterior').disabled = true; 
        document.getElementById('pag-proximo').disabled = true;
        return;
    }

    registrosPagina.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800";

        const badgeSituacao = item.Situação === "Operando" 
            ? '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-white dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-900">Operando</span>'
            : '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-white dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-400 dark:border-amber-900">Em Manutenção</span>';

        const badgeGPS = item["Status GPS"] === "Válido"
            ? '<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> Válido</span>'
            : '<span class="text-rose-500 dark:text-rose-400 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Inválido</span>';

        const textLinha = item._linhaPrefixo ? `<span class="font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded font-bold text-slate-700 dark:text-slate-200">${item._linhaPrefixo}</span>` : '<span class="text-slate-400 italic">Sem Escala</span>';

        let badgeIntegracao = "";
        if (item._integracao === "Sem Integração") {
            badgeIntegracao = '<span class="text-rose-500 dark:text-rose-400 font-bold"><i class="fa-solid fa-circle-xmark mr-1"></i> Sem Integração</span>';
        } else if (item._integracao === "Falha na Integração") {
            badgeIntegracao = '<span class="text-amber-500 dark:text-amber-400 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Falha na Integração</span>';
        }

        const resFicha = resolverEstadoFicha(item._veiculoFormatado, item._dataExportacao, item._horaExportacao);
        
        let tdFichaConteudo = '';
        if (resFicha.estado === 'Aberta') {
            tdFichaConteudo = `
                <div class="flex items-center justify-center gap-1.5">
                    <span class="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 font-black text-[10px] animate-pulse uppercase tracking-wider flex items-center gap-1">
                        <i class="fa-solid fa-triangle-exclamation"></i>Aberta
                    </span>
                    <button class="btn-fechar-ficha text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-1.5 py-0.5 rounded shadow transition-all duration-150 flex items-center gap-1"
                            data-veiculo="${item._veiculoFormatado}"
                            data-data="${item._dataExportacao}"
                            data-hora="${item._horaExportacao}"
                            data-idx="${resFicha.index}"
                            title="Marcar Ficha como Fechada/Resolvida">
                        <i class="fa-solid fa-check"></i> Fechar
                    </button>
                </div>
            `;
        } else if (resFicha.estado === 'Fechada') {
            const f = resFicha.ticket;
            tdFichaConteudo = `
                <div class="flex items-center justify-center gap-1.5">
                    <span class="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold text-[10px] flex items-center gap-1"
                          title="Aberta em ${f.data_abertura} às ${f.hora_abertura} | Fechada em ${f.data_fechamento} às ${f.hora_fechamento}">
                        <i class="fa-solid fa-circle-check"></i>Fechada
                    </span>
                    <button class="btn-limpar-ficha text-slate-400 hover:text-rose-500 transition-colors duration-150 ml-1"
                            data-idx="${resFicha.index}"
                            title="Excluir histórico deste registro">
                        <i class="fa-solid fa-trash-can text-[11px]"></i>
                    </button>
                </div>
            `;
        } else {
            tdFichaConteudo = `
                <input type="checkbox" class="chk-abrir-ficha cursor-pointer w-4 h-4 text-indigo-600 border-slate-300 dark:border-slate-700 rounded focus:ring-indigo-500 select-input"
                       data-veiculo="${item._veiculoFormatado}"
                       data-data="${item._dataExportacao}"
                       data-hora="${item._horaExportacao}">
            `;
        }

        const tdFicha = `
            <td class="align-middle">
                <div class="flex items-center justify-center gap-2">
                    ${tdFichaConteudo}
                </div>
            </td>
        `;

        tr.innerHTML = `
            <td class="font-mono font-semibold">${item._dataExportacao}</td>
            <td class="font-mono font-semibold">${item._horaExportacao}</td>
            <td>${textLinha}</td>
            <td class="font-mono font-bold text-slate-700 dark:text-slate-300">${item._veiculoFormatado}</td>
            <td>${badgeSituacao}</td>
            <td class="font-medium text-slate-600 dark:text-slate-400">${item.Fab || ''}</td>
            <td class="font-medium">${item.Status || ''}</td>
            <td class="text-xs font-medium text-slate-500 dark:text-slate-400 max-w-[200px] truncate" title="${item["Não Conformidade"] || ''}">${item["Não Conformidade"] || ''}</td>
            <td class="text-xs">${badgeGPS}</td>
            <td class="text-xs font-semibold ${item["Estado Validador"] === 'Bloqueado' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}">${item["Estado Validador"] || ''}</td>
            <td class="text-xs font-mono">${item["Hora estado validador"] || ''}</td>
            <td class="text-xs text-center">${badgeIntegracao}</td>
            ${tdFicha}
        `;
        corpo.appendChild(tr);
    });

    // Evento para ABRIR Ficha (Checkbox)
    document.querySelectorAll('.chk-abrir-ficha').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                const v = e.target.getAttribute('data-veiculo');
                const d = e.target.getAttribute('data-data');
                const h = e.target.getAttribute('data-hora');
                
                const fichas = obterFichasManutencao();
                fichas.push({
                    veiculo: v,
                    data_abertura: d,
                    hora_abertura: h,
                    data_fechamento: null,
                    hora_fechamento: null
                });
                def_salvar(fichas);
                atualizarKPIs();
                renderizarTabela();
            }
        });
    });

    // Evento para FECHAR Ficha
    document.querySelectorAll('.btn-fechar-ficha').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target.closest('.btn-fechar-ficha');
            const d = target.getAttribute('data-data');
            const h = target.getAttribute('data-hora');
            const idx = parseInt(target.getAttribute('data-idx'));
            
            const fichas = obterFichasManutencao();
            if (fichas[idx]) {
                fichas[idx].data_fechamento = d;
                fichas[idx].hora_fechamento = h;
                def_salvar(fichas);
                atualizarKPIs();
                renderizarTabela();
            }
        });
    });

    // Evento para LIMPAR Ficha (Deletar do Histórico)
    document.querySelectorAll('.btn-limpar-ficha').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target.closest('.btn-limpar-ficha');
            const idx = parseInt(target.getAttribute('data-idx'));
            
            const fichas = obterFichasManutencao();
            if (fichas[idx]) {
                fichas.splice(idx, 1);
                def_salvar(fichas);
                atualizarKPIs();
                renderizarTabela();
            }
        });
    });

    document.getElementById('txt-total-registros').textContent = `Exibindo ${fim} de ${totalRegistros} registros`;
    document.getElementById('txt-pag-atual').textContent = `Pág. ${paginaAtual} de ${totalPaginas}`;
    document.getElementById('pag-anterior').disabled = true; 
    document.getElementById('pag-proximo').disabled = true;
    if (paginaAtual > 1) document.getElementById('pag-anterior').disabled = false;
    if (paginaAtual < totalPaginas) document.getElementById('pag-proximo').disabled = false;
}

// Navegação de páginas
function navegarPagina(direcao) {
    const totalRegistros = dadosFiltrados.length;
    const totalPaginas = Math.ceil(totalRegistros / linhasPorPagina) || 1;

    paginaAtual += direcao;
    if (paginaAtual < 1) paginaAtual = 1;
    if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

    renderizarTabela();
}

// Linhas por página
function mudarLinhasPorPagina() {
    const input = document.getElementById('input-linhas-pagina');
    let valor = parseInt(input.value);
    
    if (isNaN(valor) || valor < 1) valor = 10;
    if (valor > 100) valor = 100;

    linhasPorPagina = valor;
    paginaAtual = 1;
    renderizarTabela();
}

// Sanitização de Categoria para Gráficos
function normalizarNomeCategoria(nome) {
    if (!nome) return "Não Definido";
    return nome
        .replace("Cidade de Caieiras - ", "")
        .replace("Urubupungá Municipal ", "Urubupungá ")
        .replace("Viação Cidade Caieiras", "Viação Caieiras")
        .replace("Municipal ", "Mun. ")
        .trim();
}

// Mini-cards de Não Conformidades
function atualizarMiniCards() {
    const container = document.getElementById('container-mini-cards');
    if (!container) return;

    const contagens = {
        "Sem Transmissão": 0,
        "Sem GPS Válido": 0,
        "Sem AVL": 0,
        "Sem Processar Pontos de Controle": 0,
        "Problema de Carga de Ponto": 0
    };

    dadosFiltrados.forEach(item => {
        const nc = item._naoConformidadeLimpa;
        if (nc && nc !== "") {
            if (contagens.hasOwnProperty(nc)) {
                contagens[nc]++;
            }
        }
    });

    container.innerHTML = '<span class="text-slate-500 dark:text-slate-400 uppercase text-[9px] font-black mr-2 tracking-wider flex-shrink-0">Indicador de Não Conformidades: </span>';

    Object.entries(contagens).forEach(([nome, qtd]) => {
        let corClasse = "";
        
        switch (nome) {
            case "Sem Transmissão":
                corClasse = "bg-white dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-900"; 
                break;
            case "Sem GPS Válido":
                corClasse = "bg-white dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-900"; 
                break;
            case "Sem AVL":
                corClasse = "bg-white dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-900"; 
                break;
            case "Sem Processar Pontos de Controle":
                corClasse = "bg-white dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-900"; 
                break;
            case "Problema de Carga de Ponto":
                corClasse = "bg-white dark:bg-teal-950/20 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-900"; 
                break;
            default:
                corClasse = "bg-white dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"; 
        }

        const cardHtml = `
            <div class="flex items-center gap-1.5 px-2.5 py-0.5 rounded border ${corClasse} text-[11px] font-extrabold shadow-sm transition-all duration-150">
                <span>${nome}:</span>
                <span class="font-black text-xs">${qtd}</span>
            </div>
        `;
        container.innerHTML += cardHtml;
    });
}

// Atualiza dropdown de horas
function atualizarOpcoesHora() {
    const selectData = document.getElementById('filtro-data');
    const selectHora = document.getElementById('filtro-hora');
    const horaSelecionada = selectHora.value;
    
    selectHora.innerHTML = '<option value="">Todos</option>';
    
    let dadosFiltradosPorData = dadosProcessados;
    if (selectData.value) {
        dadosFiltradosPorData = dadosProcessados.filter(d => d._dataExportacao === selectData.value);
    }
    
    const horasUnicas = [...new Set(dadosFiltradosPorData.map(d => d._horaExportacao).filter(Boolean))];
    
    horasUnicas.sort((a, b) => {
        const numA = parseInt(a.replace('h', ''));
        const numB = parseInt(b.replace('h', ''));
        return numA - numB;
    });
    
    horasUnicas.forEach(h => {
        selectHora.innerHTML += `<option value="${h}">${h}</option>`;
    });

    if (horasUnicas.includes(horaSelecionada)) {
        selectHora.value = horaSelecionada;
    } else {
        selectHora.value = "";
    }
}

// Atualiza gráficos
function atualizarGraficos() {
    const dadosNC = dadosFiltrados.filter(d => d._naoConformidadeLimpa && d._naoConformidadeLimpa !== "");

    const agruparEContar = (campo, normalizar = false) => {
        const counts = {};
        dadosNC.forEach(d => {
            let val = d[campo] || "Não Definido";
            if (normalizar) val = normalizarNomeCategoria(val);
            counts[val] = (counts[val] || 0) + 1;
        });
        return counts;
    };

    const countEmpresa = agruparEContar('_empresaGrupo');
    const countSegmento = agruparEContar('_segmento', true);
    const countVeiculo = agruparEContar('_veiculoFormatado'); 
    const countEquipamento = agruparEContar('Fab');
    const countFaixa = agruparEContar('_horaExportacao');

    const obterDadosOrdenados = (counts, limite = null) => {
        const itensOrdenados = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]); 
        
        const fatiados = limite ? itensOrdenados.slice(0, limite) : itensOrdenados;
        
        return {
            labels: fatiados.map(item => item[0]),
            data: fatiados.map(item => item[1])
        };
    };

    const dadosEmpresa = obterDadosOrdenados(countEmpresa);
    const dadosSegmento = obterDadosOrdenados(countSegmento);
    const dadosVeiculo = obterDadosOrdenados(countVeiculo, 5); 
    const dadosEquipamento = obterDadosOrdenados(countEquipamento);

    Object.keys(charts).forEach(key => {
        if (charts[key]) {
            charts[key].destroy();
        }
    });

    const isDark = document.body.classList.contains('dark');
    const gridColor = isDark ? '#1f2937' : '#cbd5e1'; 
    const textColor = isDark ? '#94a3b8' : '#0f172a'; 

    const criarGraficoBarraHorizontal = (canvasId, labels, data, corBarra, maxBarSize = 20) => {
        return new Chart(document.getElementById(canvasId), {
            type: 'bar',
            data: {
                labels: labels, 
                datasets: [{
                    data: data, 
                    backgroundColor: corBarra,
                    borderRadius: 3,
                    maxBarThickness: maxBarSize
                }]
            },
            options: {
                indexAxis: 'y', 
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: 10,
                        right: 25 
                    }
                },
                plugins: { 
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end',
                        align: (context) => {
                            const val = context.dataset.data[context.dataIndex];
                            return val < 10 ? 'end' : 'start';
                        },
                        offset: 4,
                        color: (context) => {
                            const val = context.dataset.data[context.dataIndex];
                            if (val < 10) {
                                return textColor;
                            }
                            return '#ffffff';
                        },
                        font: { weight: 'bold', size: 10 },
                        formatter: (val) => val > 0 ? val : ''
                    }
                },
                scales: {
                    x: { 
                        ticks: { precision: 0, color: textColor },
                        grid: { color: gridColor }
                    },
                    y: { 
                        ticks: { font: { size: 9, weight: 'bold' }, color: textColor },
                        grid: { display: false }
                    }
                }
            }
        });
    };

    charts.empresa = criarGraficoBarraHorizontal('chart-empresa', dadosEmpresa.labels, dadosEmpresa.data, '#10b981', 16); 
    charts.segmento = criarGraficoBarraHorizontal('chart-segmento', dadosSegmento.labels, dadosSegmento.data, '#6366f1', 20); 
    charts.veiculo = criarGraficoBarraHorizontal('chart-veiculo', dadosVeiculo.labels, dadosVeiculo.data, '#3b82f6', 20); 
    charts.equipamento = criarGraficoBarraHorizontal('chart-equipamento', dadosEquipamento.labels, dadosEquipamento.data, '#14b8a6', 20); 

    const labelsFaixa = Object.keys(countFaixa).sort();
    const dataFaixa = labelsFaixa.map(l => countFaixa[l]);

    charts.faixaHoraria = new Chart(document.getElementById('chart-faixa-horaria'), {
        type: 'line',
        data: {
            labels: labelsFaixa,
            datasets: [{
                label: 'Não Conformidades',
                data: dataFaixa,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                datalabels: { 
                    display: true, 
                    color: textColor,
                    align: 'top',
                    font: { weight: 'bold', size: 10 }
                } 
            },
            scales: {
                x: { 
                    ticks: { color: textColor },
                    grid: { display: false }
                },
                y: { 
                    ticks: { precision: 0, color: textColor },
                    grid: { color: gridColor }
                }
            }
        }
    });
}