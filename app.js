// =====================================================================
// Variáveis Globais de Controle de Dados
// =====================================================================
let dadosOriginais = [];
let dadosProcessados = [];
let dadosFiltrados = [];
let listaDatasDisponiveis = [];

let colunaOrdenada = '_data';
let ordemAscendente = false; // Data mais recente primeiro
let paginaAtual = 1;
let linhasPorPagina = 17;

Chart.register(ChartDataLabels);
let charts = { empresa: null, segmento: null, veiculo: null, equipamento: null, faixaHoraria: null };

// Filtro Cruzado Interativo dos Gráficos
let filtroGraficoAtivo = { tipo: null, valor: null };

function alternarFiltroGrafico(tipo, valor) {
    if (filtroGraficoAtivo.tipo === tipo && filtroGraficoAtivo.valor === valor) {
        filtroGraficoAtivo = { tipo: null, valor: null }; // Desmarca se clicar de novo
    } else {
        filtroGraficoAtivo = { tipo, valor }; // Aplica o filtro
    }
    aplicarFiltros();
}

const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
let fichasManutencaoGlobal = [];

const segmentosPorEmpresa = {
    "AVUL": ["Urubupungá", "Urubupungá Municipal Osasco", "Urubupungá Municipal Santana", "Urubupungá Municipal Cajamar"],
    "VCCL": ["Cidade de Caieiras - Municipal Caieiras", "Cidade de Caieiras - Municipal Franco da Rocha", "Viação Cidade Caieiras"]
};

// =====================================================================
// PERSISTÊNCIA E FICHAS DE MANUTENÇÃO
// =====================================================================

function obterFichasManutencao() { return fichasManutencaoGlobal; }

function salvarFichasManutencao(f) {
    fichasManutencaoGlobal = f;
    localStorage.setItem('manutencao_fichas', JSON.stringify(f));
    if (isLocal) {
        fetch('/salvar-fichas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
        .catch(err => console.error("Erro sincronização:", err));
    }
}

function converterParaDataObjeto(d, h) {
    if (!d) return new Date(0);
    const p = d.split("/");
    const ano = p[2].length === 2 ? "20" + p[2] : p[2];
    const hora = h ? parseInt(h.replace("h", ""), 10) : 0;
    return new Date(ano, p[1] - 1, p[0], hora, 0, 0);
}

function resolverEstadoFicha(v, d, h) {
    const fichas = obterFichasManutencao();
    const t = converterParaDataObjeto(d, h).getTime();
    for (let i = 0; i < fichas.length; i++) {
        const f = fichas[i];
        if (f.veiculo === v) {
            const ta = converterParaDataObjeto(f.data_abertura, f.hora_abertura).getTime();
            const tf = f.data_fechamento ? converterParaDataObjeto(f.data_fechamento, f.hora_fechamento).getTime() : null;
            if (t >= ta) {
                if (tf === null) return { estado: 'AbertaAtiva', ticket: f, index: i };
                else if (t < tf) return { estado: 'AbertaHistorico', ticket: f, index: i };
                else if (t === tf) return { estado: 'Fechada', ticket: f, index: i };
            }
        }
    }
    return { estado: 'Sem Ficha', ticket: null, index: -1 };
}

// =====================================================================
// INICIALIZAÇÃO E UI
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    inicializarTema();
    
    document.getElementById('filtro-data')?.addEventListener('change', (e) => carregarDados(e.target.value));
    document.getElementById('btn-atualizar')?.addEventListener('click', () => carregarDados(document.getElementById('filtro-data').value));
    document.getElementById('btn-limpar-filtros')?.addEventListener('click', limparFiltros);
    document.getElementById('input-linhas-pagina')?.addEventListener('input', mudarLinhasPorPagina);
    document.getElementById('filtro-empresa')?.addEventListener('change', () => {
        atualizarSelectSegmentos();
        aplicarFiltros();
    });

    const fIds = ['filtro-hora', 'filtro-segmento', 'filtro-situacao', 'filtro-condicao', 'filtro-equipamento', 'filtro-status', 'filtro-nao-conformidade', 'filtro-status-gps', 'filtro-integracao', 'filtro-tempo-nc'];
    fIds.forEach(id => {
        document.getElementById(id)?.addEventListener('change', aplicarFiltros);
    });

    document.getElementById('filtro-linha')?.addEventListener('input', aplicarFiltros);
    document.getElementById('filtro-veiculo')?.addEventListener('input', aplicarFiltros);
    
    document.getElementById('pag-anterior')?.addEventListener('click', () => navegarPagina(-1));
    document.getElementById('pag-proximo')?.addEventListener('click', () => navegarPagina(1));

    document.getElementById('btn-tema')?.addEventListener('click', alternarTema);
    document.getElementById('btn-fullscreen')?.addEventListener('click', alternarFullscreen);

    // Ordenação clicável nos cabeçalhos da tabela
    document.querySelectorAll('#tabela-analise th[data-sort]').forEach(th => {
        th.addEventListener('click', () => ordenarTabelaPor(th.getAttribute('data-sort')));
    });

    // Fichas de manutenção na tabela
    const corpoTabela = document.getElementById('corpo-tabela');
    if (corpoTabela) {
        corpoTabela.addEventListener('change', (e) => {
            if (e.target.classList.contains('chk-abrir-ficha')) {
                abrirFichaManutencao(e.target.dataset.veiculo, e.target.dataset.data, e.target.dataset.hora);
            }
        });
        corpoTabela.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-fechar-ficha')) {
                const idx = parseInt(e.target.dataset.idx, 10);
                fecharFichaManutencao(idx);
            }
        });
    }

    configurarBorrachinhasFiltros();
    inicializarDadosEstruturados();
});

function inicializarTema() {
    const tema = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', tema);
    atualizarIconeTema(tema);
}

function alternarTema() {
    const temaAtual = document.documentElement.getAttribute('data-theme') || 'dark';
    const novoTema = temaAtual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', novoTema);
    localStorage.setItem('theme', novoTema);
    atualizarIconeTema(novoTema);
    atualizarGraficos();
}

function atualizarIconeTema(tema) {
    const icon = document.getElementById('icon-tema');
    if (icon) {
        icon.className = tema === 'dark' ? 'ph ph-sun' : 'ph ph-moon';
    }
}

function alternarFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('icon-fullscreen');
    if (icon) icon.className = document.fullscreenElement ? 'ph ph-arrows-in' : 'ph ph-arrows-out';
});

// =====================================================================
// CARGA E PROCESSAMENTO DE DADOS
// =====================================================================

function inicializarDadosEstruturados() {
    const ts = new Date().getTime();
    
    fetch(`fichas_manutencao.json?v=${ts}`)
        .then(r => r.ok ? r.json() : [])
        .then(f => { fichasManutencaoGlobal = Array.isArray(f) ? f : []; })
        .catch(() => { fichasManutencaoGlobal = []; })
        .finally(() => {
            fetch(`datas.json?v=${ts}`)
                .then(r => r.ok ? r.json() : [])
                .then(datas => {
                    if (Array.isArray(datas) && datas.length > 0) {
                        listaDatasDisponiveis = datas;
                        const sData = document.getElementById('filtro-data');
                        sData.innerHTML = datas.map(v => `<option value="${v}">${v}</option>`).join('');
                        sData.value = datas[datas.length - 1];
                        carregarDados(sData.value);
                    } else {
                        carregarDados();
                    }
                })
                .catch(() => carregarDados());
        });
}

function carregarDados(dataEsp) {
    const icon = document.getElementById('icon-reload');
    const txtAtualizado = document.getElementById('txt-atualizado-em');
    if (icon) icon.classList.add('rotate-anim');
    
    const arq = dataEsp ? `dados-${dataEsp.replace(/\//g, '-')}.json` : 'dados.json';
    
    fetch(`${arq}?v=${new Date().getTime()}`)
        .then(r => {
            if (!r.ok) throw new Error("Arquivo não encontrado");
            return r.json();
        })
        .then(dados => {
            dadosOriginais = Array.isArray(dados) ? dados : [];
            processarDadosGerais();
            preencherOpcoesFiltros();
            
            if (dataEsp) {
                const sData = document.getElementById('filtro-data');
                if (sData) sData.value = dataEsp;
            }
            
            aplicarFiltros();

            if (txtAtualizado) {
                let horaExibicao = "";
                if (dadosOriginais.length > 0) {
                    const ultimoItem = dadosOriginais[dadosOriginais.length - 1];
                    // Prioriza o campo com minutos (Hora_Extracao) se existir
                    horaExibicao = ultimoItem["Hora_Extracao"] || ultimoItem["Hora"] || "";
                }
                
                if (!horaExibicao) {
                    horaExibicao = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                }

                txtAtualizado.textContent = `Atualizado às ${horaExibicao}`;
            }
        })
        .catch(err => {
            console.error("Erro ao carregar dados:", err);
            if (arq !== 'dados.json') carregarDados();
            if (txtAtualizado) txtAtualizado.textContent = "Erro ao carregar";
        })
        .finally(() => { if (icon) icon.classList.remove('rotate-anim'); });
}

function formatarDataHoraValidador(str) {
    if (!str || str === "" || str === "null") return "";
    try {
        const partes = str.split("T");
        if (partes.length < 2) return str;
        const d = partes[0].split("-");
        return `${d[2]}/${d[1]}/${d[0]} - ${partes[1]}`;
    } catch(e) { return str; }
}

function calcularStatusIntegracao(item) {
    const fab = item["Fabricante"] || "";
    if (!(fab.includes("Autopass V2") || fab.includes("Prodata V2"))) return "Não Aplicável";
    
    const horaValRaw = item["Hora Validador"] || "";
    if (!horaValRaw || horaValRaw === "" || horaValRaw === "null") return "Sem Integração";
    
    let dataExtracao = item["Data"] || "";
    let horaExtracao = String(item["Hora"] || "").replace("h", "").trim().padStart(2, '0');

    try {
        const p = horaValRaw.split("T");
        const dVal = p[0].split("-");
        const anoVal = dVal[0].length === 2 ? `20${dVal[0]}` : dVal[0];
        const dataValComp = `${dVal[2]}/${dVal[1]}/${anoVal}`;
        const horaValComp = p[1].split(":")[0].padStart(2, '0');

        return (dataValComp === dataExtracao && horaValComp === horaExtracao) ? "Integrado" : "Falha na Integração";
    } catch(e) { 
        return "Falha na Integração"; 
    }
}

function processarDadosGerais() {
    dadosProcessados = dadosOriginais.map(item => {
        const segmento = item["Segmento"] || item["Empresa"] || "";
        const linhaFull = String(item["Linha"] || "").trim();
        const prefixo = item["Prefixo"] || "00000";
        const situacao = item["Situação Veículo"] || "N/D";
        const fab = item["Fabricante"] || "";
        const statusCom = item["Status"] || "N/D";
        const ncOriginal = item["Não Conformidade"] || "";
        const gpsStatus = item["GPS Status"] || "0";
        const horaValRaw = item["Hora Validador"] || "";

        const empresaGrupo = segmentosPorEmpresa["AVUL"].includes(segmento) ? "AVUL" : "VCCL";
        const condicao = (linhaFull !== "" && linhaFull !== "null") ? "Escalado" : "Sem Escala";

        let ncResumida = "Normal";
        if (ncOriginal !== "") {
            const low = ncOriginal.toLowerCase();
            if (low.includes("sem gps válido")) ncResumida = "Sem GPS Válido";
            else if (low.includes("pontos de controle")) ncResumida = "Sem Processar Ponto";
            else if (low.includes("sem avl")) ncResumida = "Sem AVL";
            else if (low.includes("sem transmissão")) ncResumida = "Sem Transmissão";
            else ncResumida = "Outros";
        }

        let dataNormalizada = item["Data"] || "";
        if (dataNormalizada.includes("/")) {
            const p = dataNormalizada.split("/");
            if (p.length === 3 && p[2].length === 2) {
                dataNormalizada = `${p[0]}/${p[1]}/20${p[2]}`;
            }
        }

        let horasNC = 0;
        if (ncOriginal) {
            const match = ncOriginal.match(/(\d+)h/i);
            if (match && match[1]) {
                horasNC = parseInt(match[1], 10);
            }
        }

        return {
            ...item,
            _data: dataNormalizada,
            _hora: item["Hora"] || "",
            _empresa: empresaGrupo,
            _segmento: segmento,
            _veiculo: String(prefixo).padStart(5, '0'),
            _linha: linhaFull.split("-")[0].trim(),
            _situacao: situacao,
            _condicao: condicao,
            _equipamento: fab === "" ? "Sem Equipamento" : fab,
            _status: statusCom,
            _ncOriginal: ncOriginal,
            _ncResumida: ncResumida,
            _horasNC: horasNC,
            _gps: (gpsStatus == "1") ? "Válido" : "Inválido",
            _horaVal: formatarDataHoraValidador(horaValRaw),
            _integracao: calcularStatusIntegracao(item)
        };
    });
}

// =====================================================================
// FILTROS, CASCATA E BORRACHINHAS
// =====================================================================

function preencherOpcoesFiltros() {
    const unicos = (prop) => [...new Set(dadosProcessados.map(d => d[prop]).filter(Boolean))].sort();

    const sData = document.getElementById('filtro-data');
    if (sData && sData.options.length === 0) {
        const datasNoArquivo = unicos('_data');
        if (datasNoArquivo.length > 0) {
            sData.innerHTML = datasNoArquivo.map(v => `<option value="${v}">${v}</option>`).join('');
            sData.value = datasNoArquivo[datasNoArquivo.length - 1];
        }
    }
    
    document.getElementById('filtro-empresa').innerHTML = '<option value="">Todas</option>' + unicos('_empresa').map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('filtro-condicao').innerHTML = '<option value="">Todas</option><option value="Escalado">Escalado</option><option value="Sem Escala">Sem Escala</option>';
    document.getElementById('filtro-situacao').innerHTML = '<option value="">Todos</option>' + unicos('_situacao').map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('filtro-equipamento').innerHTML = '<option value="">Todos</option>' + unicos('_equipamento').map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('filtro-status').innerHTML = '<option value="">Todos</option>' + unicos('_status').map(v => `<option value="${v}">${v}</option>`).join('');
    
    const listaNC = unicos('_ncResumida').filter(v => v !== "Normal");
    document.getElementById('filtro-nao-conformidade').innerHTML = '<option value="">Todas</option>' + listaNC.map(v => `<option value="${v}">${v}</option>`).join('');
    document.getElementById('filtro-status-gps').innerHTML = '<option value="">Todos</option><option value="Válido">Válido</option><option value="Inválido">Inválido</option>';
    document.getElementById('filtro-integracao').innerHTML = '<option value="">Todas</option>' + unicos('_integracao').map(v => `<option value="${v}">${v}</option>`).join('');

    atualizarSelectSegmentos();
    atualizarOpcoesHora();
}

function atualizarSelectSegmentos() {
    const empresaSel = document.getElementById('filtro-empresa').value;
    const sSeg = document.getElementById('filtro-segmento');
    let lista = (empresaSel === "") ? [...segmentosPorEmpresa["AVUL"], ...segmentosPorEmpresa["VCCL"]] : segmentosPorEmpresa[empresaSel];
    sSeg.innerHTML = '<option value="">Todos</option>' + lista.sort().map(v => `<option value="${v}">${v}</option>`).join('');
}

function atualizarOpcoesHora() {
    const sHora = document.getElementById('filtro-hora');
    const horas = [...new Set(dadosProcessados.map(d => d._hora))].sort((a,b) => parseInt(a, 10) - parseInt(b, 10));
    sHora.innerHTML = '<option value="">Todas</option>' + horas.map(v => `<option value="${v}">${v}</option>`).join('');
}

function configurarBorrachinhasFiltros() {
    document.querySelectorAll('.btn-clear-single').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetId = btn.getAttribute('data-target');
            const el = document.getElementById(targetId);
            if (!el) return;

            if (el.tagName === 'SELECT') {
                el.value = el.querySelector('option[value=""]') ? "" : (el.options[0]?.value || "");
            } else if (el.tagName === 'INPUT') {
                el.value = '';
            }

            if (targetId === 'filtro-empresa') {
                atualizarSelectSegmentos();
            }

            aplicarFiltros();
        });
    });
}

function aplicarFiltros() {
    const elTempoNC = document.getElementById('filtro-tempo-nc');
    const minHorasNC = elTempoNC ? parseInt(elTempoNC.value, 10) || 0 : 0;

    const f = {
        data: document.getElementById('filtro-data')?.value || '',
        hora: document.getElementById('filtro-hora')?.value || '',
        empresa: document.getElementById('filtro-empresa')?.value || '',
        segmento: document.getElementById('filtro-segmento')?.value || '',
        condicao: document.getElementById('filtro-condicao')?.value || '',
        veiculo: (document.getElementById('filtro-veiculo')?.value || '').trim(),
        situacao: document.getElementById('filtro-situacao')?.value || '',
        linha: (document.getElementById('filtro-linha')?.value || '').trim(),
        equip: document.getElementById('filtro-equipamento')?.value || '',
        status: document.getElementById('filtro-status')?.value || '',
        nc: document.getElementById('filtro-nao-conformidade')?.value || '',
        gps: document.getElementById('filtro-status-gps')?.value || '',
        int: document.getElementById('filtro-integracao')?.value || '',
        minHorasNC: minHorasNC
    };

    dadosFiltrados = dadosProcessados.filter(d => {
        if (f.data && d._data !== f.data) return false;
        if (f.hora && d._hora !== f.hora) return false;
        if (f.empresa && d._empresa !== f.empresa) return false;
        if (f.segmento && d._segmento !== f.segmento) return false;
        if (f.condicao && d._condicao !== f.condicao) return false;
        if (f.veiculo && !d._veiculo.includes(f.veiculo)) return false;
        if (f.situacao && d._situacao !== f.situacao) return false;
        if (f.linha && !d._linha.includes(f.linha)) return false;
        if (f.equip && d._equipamento !== f.equip) return false;
        if (f.status && d._status !== f.status) return false;
        if (f.nc && d._ncResumida !== f.nc) return false;
        if (f.gps && d._gps !== f.gps) return false;
        if (f.int && d._integracao !== f.int) return false;
        if (f.minHorasNC > 0 && d._horasNC < f.minHorasNC) return false;

        // Filtros Cruzados dos Gráficos
        if (filtroGraficoAtivo.tipo) {
            if (filtroGraficoAtivo.tipo === 'empresa' && d._empresa !== filtroGraficoAtivo.valor) return false;
            if (filtroGraficoAtivo.tipo === 'segmento' && d._segmento !== filtroGraficoAtivo.valor) return false;
            if (filtroGraficoAtivo.tipo === 'veiculo' && d._veiculo !== filtroGraficoAtivo.valor) return false;
            if (filtroGraficoAtivo.tipo === 'equipamento' && d._equipamento !== filtroGraficoAtivo.valor) return false;
        }

        return true;
    });

    paginaAtual = 1;
    atualizarKPIs();
    renderizarTabela();
    atualizarMiniCards();
    atualizarGraficos();
}

function atualizarKPIs() {
    const total = dadosFiltrados.length;
    const operando = dadosFiltrados.filter(d => d._situacao === "Operando").length;
    const manutencao = dadosFiltrados.filter(d => d._situacao === "Em Manutenção").length;
    const escalados = dadosFiltrados.filter(d => d._condicao === "Escalado").length;
    const semEscala = total - escalados;
    const gpsValido = dadosFiltrados.filter(d => d._gps === "Válido").length;
    const falhaInt = dadosFiltrados.filter(d => d._integracao === "Falha na Integração").length;
    
    const fichasAbertas = new Set(dadosFiltrados.filter(d => resolverEstadoFicha(d._veiculo, d._data, d._hora).estado.startsWith('Aberta')).map(d => d._veiculo)).size;

    document.getElementById('kpi-total').textContent = total.toLocaleString('pt-BR');
    document.getElementById('kpi-operando').textContent = operando.toLocaleString('pt-BR');
    document.getElementById('kpi-manutencao').textContent = manutencao.toLocaleString('pt-BR');
    document.getElementById('kpi-escalados').textContent = escalados.toLocaleString('pt-BR');
    document.getElementById('kpi-sem-escala').textContent = semEscala.toLocaleString('pt-BR');
    document.getElementById('kpi-gps-valido').textContent = gpsValido.toLocaleString('pt-BR');
    document.getElementById('kpi-gps-invalido').textContent = (total - gpsValido).toLocaleString('pt-BR');
    document.getElementById('kpi-falha-integracao').textContent = falhaInt.toLocaleString('pt-BR');
    document.getElementById('kpi-fichas-abertas').textContent = fichasAbertas.toLocaleString('pt-BR');
}

// =====================================================================
// TABELA E ORDENAÇÃO
// =====================================================================

function ordenarTabelaPor(coluna) {
    if (colunaOrdenada === coluna) {
        ordemAscendente = !ordemAscendente;
    } else {
        colunaOrdenada = coluna;
        ordemAscendente = true;
    }

    // Atualiza visual dos cabeçalhos
    document.querySelectorAll('#tabela-analise th[data-sort]').forEach(th => {
        const key = th.getAttribute('data-sort');
        if (key === colunaOrdenada) {
            th.classList.add('sorted');
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.className = ordemAscendente ? 'ph ph-caret-up sort-icon' : 'ph ph-caret-down sort-icon';
        } else {
            th.classList.remove('sorted');
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.className = 'ph ph-caret-up-down sort-icon';
        }
    });

    renderizarTabela();
}

function obterDadosOrdenados() {
    if (!colunaOrdenada) return dadosFiltrados;

    return [...dadosFiltrados].sort((a, b) => {
        let vA = a[colunaOrdenada] !== undefined ? a[colunaOrdenada] : '';
        let vB = b[colunaOrdenada] !== undefined ? b[colunaOrdenada] : '';

        if (colunaOrdenada === '_data') {
            const pA = String(vA).split('/');
            const pB = String(vB).split('/');
            const dA = `${pA[2] || ''}-${pA[1] || ''}-${pA[0] || ''}`;
            const dB = `${pB[2] || ''}-${pB[1] || ''}-${pB[0] || ''}`;
            return ordemAscendente ? dA.localeCompare(dB) : dB.localeCompare(dA);
        }

        const nA = Number(vA);
        const nB = Number(vB);
        if (!isNaN(nA) && !isNaN(nB) && vA !== '' && vB !== '') {
            return ordemAscendente ? nA - nB : nB - nA;
        }

        return ordemAscendente
            ? String(vA).localeCompare(String(vB), 'pt-BR', { numeric: true })
            : String(vB).localeCompare(String(vA), 'pt-BR', { numeric: true });
    });
}

function renderizarTabela() {
    const corpo = document.getElementById('corpo-tabela');
    if (!corpo) return;
    corpo.innerHTML = '';
    
    const dadosOrdenados = obterDadosOrdenados();
    const total = dadosOrdenados.length;
    const paginas = Math.ceil(total / linhasPorPagina) || 1;
    if (paginaAtual > paginas) paginaAtual = paginas;
    
    const inicio = (paginaAtual - 1) * linhasPorPagina;
    const fim = Math.min(inicio + linhasPorPagina, total);
    const registros = dadosOrdenados.slice(inicio, fim);

    if (total === 0) {
        corpo.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 2rem; color: var(--text-muted); font-weight: 700;">Nenhum registro encontrado.</td></tr>';
        document.getElementById('txt-total-registros').textContent = "Exibindo 0 de 0 registros";
        document.getElementById('txt-pag-atual').textContent = "Página 1 de 1";
        return;
    }

    corpo.innerHTML = registros.map(item => {
        const resFicha = resolverEstadoFicha(item._veiculo, item._data, item._hora);
        
        const badgeSit = item._situacao === "Operando" 
            ? '<span class="badge operando">Operando</span>'
            : '<span class="badge manutencao">Manutenção</span>';

        const corInt = item._integracao === "Integrado" ? "badge integrado" : (item._integracao === "Não Aplicável" ? "badge nao-aplic" : "badge falha-int");
        const corGps = item._gps === "Válido" ? "badge valido" : "badge invalido";

        const fichaHtml = resFicha.estado === 'Sem Ficha'
            ? `<input type="checkbox" class="chk-abrir-ficha" data-veiculo="${item._veiculo}" data-data="${item._data}" data-hora="${item._hora}">`
            : `<div style="display: inline-flex; align-items: center; gap: 0.35rem;"><span class="badge aberta-pulse">ABERTA</span><button class="btn-fechar-ficha" data-idx="${resFicha.index}">Fechar</button></div>`;

        return `
            <tr>
                <td>${item._data}</td>
                <td>${item._hora}</td>
                <td style="font-weight: 700;">${item._linha}</td>
                <td style="font-weight: 800; color: var(--primary); font-family: monospace;">${item._veiculo}</td>
                <td>${badgeSit}</td>
                <td style="font-size: 0.72rem;">${item._equipamento}</td>
                <td style="font-size: 0.72rem;">${item._status}</td>
                <td style="max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item._ncOriginal}">${item._ncOriginal}</td>
                <td><span class="${corGps}">${item._gps}</span></td>
                <td style="font-family: monospace; font-size: 0.72rem;">${item._horaVal}</td>
                <td><span class="${corInt}">${item._integracao}</span></td>
                <td>${fichaHtml}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('txt-total-registros').textContent = `Exibindo ${total > 0 ? inicio + 1 : 0} a ${fim} de ${total} registros`;
    document.getElementById('txt-pag-atual').textContent = `Página ${paginaAtual} de ${paginas}`;
    document.getElementById('pag-anterior').disabled = paginaAtual <= 1;
    document.getElementById('pag-proximo').disabled = paginaAtual >= paginas;
}

function navegarPagina(dir) {
    paginaAtual += dir;
    renderizarTabela();
}

function mudarLinhasPorPagina() {
    linhasPorPagina = parseInt(document.getElementById('input-linhas-pagina').value, 10) || 10;
    paginaAtual = 1;
    renderizarTabela();
}

function limparFiltros() {
    ['filtro-hora', 'filtro-empresa', 'filtro-segmento', 'filtro-situacao', 'filtro-condicao', 'filtro-equipamento', 'filtro-status', 'filtro-nao-conformidade', 'filtro-status-gps', 'filtro-integracao'].forEach(id => { 
        const el = document.getElementById(id);
        if (el) el.value = ""; 
    });
    
    const elLinha = document.getElementById('filtro-linha');
    if (elLinha) elLinha.value = "";
    
    const elVeiculo = document.getElementById('filtro-veiculo');
    if (elVeiculo) elVeiculo.value = "";

    const elTempo = document.getElementById('filtro-tempo-nc');
    if (elTempo) elTempo.value = "0";

    colunaOrdenada = '_data';
    ordemAscendente = false;

    filtroGraficoAtivo = { tipo: null, valor: null };

    atualizarSelectSegmentos();
    aplicarFiltros();
}

// =====================================================================
// GRÁFICOS OTIMIZADOS E INTERATIVOS COM DATA LABELS
// =====================================================================

function obterCorBarra(tipo, valor, corPadrao) {
    if (!filtroGraficoAtivo.tipo) return corPadrao;
    if (filtroGraficoAtivo.tipo === tipo && filtroGraficoAtivo.valor === valor) {
        return corPadrao;
    }
    return 'rgba(148, 163, 184, 0.25)'; // Barra inativa fica translúcida
}

function criarBarraHorizontalInterativa(canvasId, chartInst, itens, config) {
    if (chartInst) chartInst.destroy();
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return null;

    const labels = itens.map(i => i.label);
    const data = itens.map(i => i.value);
    const cores = itens.map(i => obterCorBarra(config.tipoFiltro, i.label, i.color || config.cor));

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Sem NC'],
            datasets: [{
                data: data.length > 0 ? data : [0],
                backgroundColor: cores.length > 0 ? cores : [config.cor],
                borderRadius: 5,
                barPercentage: 0.75,
                categoryPercentage: 0.85
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                if (!elements || elements.length === 0) return;
                const idx = elements[0].index;
                if (itens[idx]) {
                    alternarFiltroGrafico(config.tipoFiltro, itens[idx].label);
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        title: (items) => itens[items[0].dataIndex]?.label || '',
                        label: (item) => ` Ocorrências: ${item.raw}`
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'start',
                    color: '#ffffff',
                    font: { weight: 'bold', size: 10 },
                    formatter: (val) => (val > 0 ? val : '')
                }
            },
            scales: {
                x: { display: false, grid: { display: false } },
                y: {
                    ticks: {
                        color: config.corTexto,
                        font: { size: 9, weight: '600' },
                        callback: function(val) {
                            return this.getLabelForValue(val);
                        }
                    },
                    grid: { display: false }
                }
            }
        }
    });
}

function atualizarGraficos() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const labelColor = isDark ? '#94a3b8' : '#475569';

    // Agrupador auxiliar
    const agruparItens = (prop, limite = 0) => {
        const res = {};
        dadosFiltrados.forEach(d => {
            if (d._ncResumida !== "Normal") {
                let val = d[prop] || "N/D";
                res[val] = (res[val] || 0) + 1;
            }
        });
        let lista = Object.keys(res).map(k => ({ label: k, value: res[k] }));
        lista.sort((a, b) => b.value - a.value);
        return limite > 0 ? lista.slice(0, limite) : lista;
    };

    // 1. Empresa (Esmeralda)
    const dadosEmp = agruparItens('_empresa');
    charts.empresa = criarBarraHorizontalInterativa('chart-empresa', charts.empresa, dadosEmp, {
        cor: '#10b981', corTexto: labelColor, tipoFiltro: 'empresa'
    });

    // 2. Segmento (Índigo)
    const dadosSeg = agruparItens('_segmento');
    charts.segmento = criarBarraHorizontalInterativa('chart-segmento', charts.segmento, dadosSeg, {
        cor: '#6366f1', corTexto: labelColor, tipoFiltro: 'segmento'
    });

    // 3. Veículo (Ranking Térmico com Scroll Suave)
    const dadosVei = agruparItens('_veiculo');
    const totalVei = dadosVei.length;

    // Aplica paleta térmica nos veículos
    dadosVei.forEach((item, i) => {
        if (totalVei <= 1) { item.color = '#ef4444'; return; }
        const ratio = i / (totalVei - 1);
        if (ratio < 0.30) item.color = '#ef4444';      // Vermelho (Mais falhas)
        else if (ratio < 0.60) item.color = '#f97316'; // Laranja
        else if (ratio < 0.85) item.color = '#eab308'; // Amarelo
        else item.color = '#10b981';                   // Verde (Menos falhas)
    });

    const containerScroll = document.getElementById('container-scroll-veiculo');
    if (containerScroll) {
        const alturaMinima = 160;
        const alturaCalculada = Math.max(alturaMinima, totalVei * 22);
        containerScroll.style.height = `${alturaCalculada}px`;
    }

    charts.veiculo = criarBarraHorizontalInterativa('chart-veiculo', charts.veiculo, dadosVei, {
        cor: '#ef4444', corTexto: labelColor, tipoFiltro: 'veiculo'
    });

    // 4. Equipamento (Âmbar)
    const dadosEquip = agruparItens('_equipamento');
    charts.equipamento = criarBarraHorizontalInterativa('chart-equipamento', charts.equipamento, dadosEquip, {
        cor: '#f59e0b', corTexto: labelColor, tipoFiltro: 'equipamento'
    });

    // 5. Linha Temporal: Faixa Horária
    const resHora = {};
    dadosFiltrados.forEach(d => {
        if (d._ncResumida !== "Normal") {
            let h = d._hora || "N/D";
            resHora[h] = (resHora[h] || 0) + 1;
        }
    });
    const horasOrdenadas = Object.keys(resHora).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const dataHora = horasOrdenadas.map(h => resHora[h]);

    if (charts.faixaHoraria) charts.faixaHoraria.destroy();
    const ctxHora = document.getElementById('chart-faixa-horaria')?.getContext('2d');
    if (ctxHora) {
        charts.faixaHoraria = new Chart(ctxHora, {
            type: 'line',
            data: {
                labels: horasOrdenadas.length > 0 ? horasOrdenadas : ['Sem dados'],
                datasets: [{
                    data: dataHora.length > 0 ? dataHora : [0],
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    fill: true,
                    tension: 0.35,
                    pointBackgroundColor: '#ef4444',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        display: true,
                        color: labelColor,
                        align: 'top',
                        font: { weight: 'bold', size: 10 },
                        formatter: (val) => val > 0 ? val : ''
                    }
                },
                scales: {
                    y: { display: false, grid: { display: false } },
                    x: { ticks: { color: labelColor, font: { size: 10, weight: '600' } }, grid: { display: false } }
                }
            }
        });
    }
}

function atualizarMiniCards() {
    const container = document.getElementById('container-mini-cards');
    if (!container) return;
    const ncs = ["Sem Transmissão", "Sem GPS Válido", "Sem AVL", "Sem Processar Ponto"];
    
    container.innerHTML = ncs.map(nc => {
        const qtd = dadosFiltrados.filter(d => d._ncResumida === nc).length;
        return `<div class="mini-card-sit"><span>${nc}:</span><strong>${qtd}</strong></div>`;
    }).join('');
}

// =====================================================================
// AÇÕES DAS FICHAS DE MANUTENÇÃO
// =====================================================================

function abrirFichaManutencao(veiculo, data, hora) {
    const payload = { veiculo, data_abertura: data, hora_abertura: hora };
    
    if (isLocal) {
        fetch('/salvar-ficha-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(() => carregarFichasEAtualizar());
    } else {
        fichasManutencaoGlobal.push({ ...payload, data_fechamento: null, hora_fechamento: null });
        localStorage.setItem('manutencao_fichas', JSON.stringify(fichasManutencaoGlobal));
        atualizarKPIs();
        renderizarTabela();
    }
}

function fecharFichaManutencao(index) {
    const ficha = fichasManutencaoGlobal[index];
    if (!ficha) return;

    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = String(agora.getFullYear()).slice(-2);
    const data_fc = `${dia}/${mes}/${ano}`;
    const hora_fc = `${agora.getHours()}h`;

    if (isLocal && ficha.id) {
        fetch('/fechar-ficha-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: ficha.id, data_fechamento: data_fc, hora_fechamento: hora_fc })
        }).then(() => carregarFichasEAtualizar());
    } else {
        ficha.data_fechamento = data_fc;
        ficha.hora_fechamento = hora_fc;
        localStorage.setItem('manutencao_fichas', JSON.stringify(fichasManutencaoGlobal));
        atualizarKPIs();
        renderizarTabela();
    }
}

function carregarFichasEAtualizar() {
    fetch(`fichas_manutencao.json?v=${new Date().getTime()}`)
        .then(r => r.json())
        .then(f => {
            fichasManutencaoGlobal = f;
            localStorage.setItem('manutencao_fichas', JSON.stringify(f));
            atualizarKPIs();
            renderizarTabela();
        });
}