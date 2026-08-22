// =====================================================================
// Variáveis Globais de Controle de Dados
// =====================================================================
let dadosOriginais = [];
let dadosProcessados = [];
let dadosFiltrados = [];
let listaDatasDisponiveis = [];

let colunaOrdenada = '';
let ordemAscendente = true;
let paginaAtual = 1;
let linhasPorPagina = 10;

Chart.register(ChartDataLabels);
let charts = { empresa: null, segmento: null, veiculo: null, equipamento: null, faixaHoraria: null };

const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
let fichasManutencaoGlobal = [];

const segmentosPorEmpresa = {
    "AVUL": ["Urubupungá", "Urubupungá Municipal Osasco", "Urubupungá Municipal Santana", "Urubupungá Municipal Cajamar"],
    "VCCL": ["Cidade de Caieiras - Municipal Caieiras", "Cidade de Caieiras - Municipal Franco da Rocha", "Viação Cidade Caieiras"]
};

// =====================================================================
//           FUNÇÕES DE PERSISTÊNCIA E TIMELINE
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
    const ano = p[2].length === 2 ? "20"+p[2] : p[2];
    const hora = h ? parseInt(h.replace("h", "")) : 0;
    return new Date(ano, p[1]-1, p[0], hora, 0, 0);
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
//                         INICIALIZAÇÃO E UI
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    inicializarTema();
    
    document.getElementById('filtro-data').addEventListener('change', (e) => carregarDados(e.target.value));
    document.getElementById('btn-atualizar').addEventListener('click', () => carregarDados(document.getElementById('filtro-data').value));
    document.getElementById('btn-limpar-filtros').addEventListener('click', limparFiltros);
    document.getElementById('input-linhas-pagina').addEventListener('input', mudarLinhasPorPagina);
    document.getElementById('filtro-empresa').addEventListener('change', atualizarSelectSegmentos);

    const fIds = ['filtro-hora', 'filtro-empresa', 'filtro-segmento', 'filtro-situacao', 'filtro-condicao', 'filtro-equipamento', 'filtro-status', 'filtro-nao-conformidade', 'filtro-status-gps', 'filtro-integracao'];
    fIds.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', aplicarFiltros);
    });

    document.getElementById('filtro-linha').addEventListener('input', aplicarFiltros);
    document.getElementById('filtro-veiculo').addEventListener('input', aplicarFiltros);
    
    const filtroTempoNC = document.getElementById('filtro-tempo-nc');
    if (filtroTempoNC) filtroTempoNC.addEventListener('change', aplicarFiltros);
    
    document.getElementById('pag-anterior').addEventListener('click', () => navegarPagina(-1));
    document.getElementById('pag-proximo').addEventListener('click', () => navegarPagina(1));

    document.getElementById('btn-tema').addEventListener('click', alternarTema);
    document.getElementById('btn-fullscreen').addEventListener('click', alternarFullscreen);

    document.querySelectorAll('#tabela-analise th[data-sort]').forEach(th => {
        th.addEventListener('click', () => ordenarTabelaPor(th.getAttribute('data-sort')));
    });

    // Listener para abrir e fechar fichas de manutenção diretamente na tabela
    const corpoTabela = document.getElementById('corpo-tabela');
    if (corpoTabela) {
        corpoTabela.addEventListener('change', (e) => {
            if (e.target.classList.contains('chk-abrir-ficha')) {
                abrirFichaManutencao(e.target.dataset.veiculo, e.target.dataset.data, e.target.dataset.hora);
            }
        });
        corpoTabela.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-fechar-ficha')) {
                const idx = parseInt(e.target.dataset.idx);
                fecharFichaManutencao(idx);
            }
        });
    }

    inicializarDadosEstruturados();
});

function inicializarTema() {
    const tema = localStorage.getItem('theme') || 'light';
    const icon = document.getElementById('icon-tema');
    if (tema === 'dark') {
        document.body.classList.add('dark');
        icon.className = 'fa-solid fa-sun text-sm';
    } else {
        document.body.classList.remove('dark');
        icon.className = 'fa-solid fa-moon text-sm';
    }
}

function alternarTema() {
    const isNowDark = document.body.classList.toggle('dark');
    localStorage.setItem('theme', isNowDark ? 'dark' : 'light');
    const icon = document.getElementById('icon-tema');
    icon.className = isNowDark ? 'fa-solid fa-sun text-sm' : 'fa-solid fa-moon text-sm';
    atualizarGraficos(); 
}

function alternarFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => {
    const icon = document.getElementById('icon-fullscreen');
    if(icon) icon.className = document.fullscreenElement ? 'fa-solid fa-compress text-sm' : 'fa-solid fa-expand text-sm';
});

// =====================================================================
//                      CARGA E PROCESSAMENTO
// =====================================================================

function inicializarDadosEstruturados() {
    const ts = new Date().getTime();
    
    // 1. Carrega as fichas de manutenção
    fetch(`fichas_manutencao.json?v=${ts}`)
        .then(r => r.ok ? r.json() : [])
        .then(f => { fichasManutencaoGlobal = Array.isArray(f) ? f : []; })
        .catch(() => { fichasManutencaoGlobal = []; })
        .finally(() => {
            // 2. Carrega a lista de datas disponíveis
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
                        carregarDados(); // Carrega dados.json padrão
                    }
                })
                .catch(() => carregarDados());
        });
}

function carregarDados(dataEsp) {
    const icon = document.getElementById('icon-reload');
    const txtAtualizado = document.getElementById('txt-atualizado-em');
    if(icon) icon.classList.add('rotate-anim');
    
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
            
            // Garante que o select mantenha a data selecionada
            if (dataEsp) {
                const sData = document.getElementById('filtro-data');
                if (sData) sData.value = dataEsp;
            }
            
            aplicarFiltros();

            if (txtAtualizado) {
                const ultHora = dadosOriginais.length > 0 ? dadosOriginais[dadosOriginais.length - 1]["Hora"] || "" : "";
                txtAtualizado.textContent = `Atualizado às ${ultHora || new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
            }
        })
        .catch(err => {
            console.error("Erro ao carregar dados:", err);
            // Fallback para dados.json se o arquivo diário falhar
            if (arq !== 'dados.json') carregarDados();
            if (txtAtualizado) txtAtualizado.textContent = "Erro ao carregar";
        })
        .finally(() => { if(icon) icon.classList.remove('rotate-anim'); });
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
    // Aplica-se exclusivamente aos validadores Autopass V2 e Prodata V2
    if (!(fab.includes("Autopass V2") || fab.includes("Prodata V2"))) return "Não Aplicável";
    
    const horaValRaw = item["Hora Validador"] || "";
    if (!horaValRaw || horaValRaw === "" || horaValRaw === "null") return "Sem Integração";
    
    let dataExtracao = item["Data"] || "";
    let horaExtracao = String(item["Hora"] || "").replace("h", "").trim();
    
    // Normaliza hora de extração com 2 dígitos (ex: "8" -> "08")
    horaExtracao = horaExtracao.padStart(2, '0');

    try {
        const p = horaValRaw.split("T");
        const dVal = p[0].split("-"); // [YYYY, MM, DD]
        
        // Data formatada com 4 dígitos no ano: DD/MM/YYYY
        const anoVal = dVal[0].length === 2 ? `20${dVal[0]}` : dVal[0];
        const dataValComp = `${dVal[2]}/${dVal[1]}/${anoVal}`;
        
        // Hora formatada com 2 dígitos (ex: "08")
        const horaValComp = p[1].split(":")[0].padStart(2, '0');

        // Se a data e a hora coincidirem com a rodada de extração -> "Integrado"
        if (dataValComp === dataExtracao && horaValComp === horaExtracao) {
            return "Integrado";
        } else {
            return "Falha na Integração";
        }
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

        // Normaliza a data para 4 dígitos no ano (DD/MM/YYYY) para bater com o filtro
        let dataNormalizada = item["Data"] || "";
        if (dataNormalizada.includes("/")) {
            const p = dataNormalizada.split("/");
            if (p.length === 3 && p[2].length === 2) {
                dataNormalizada = `${p[0]}/${p[1]}/20${p[2]}`;
            }
        }

        // Extrai as horas numéricas da descrição da Não Conformidade (ex: "Veículo sem transmissão 962h40min" -> 962)
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
//                       FILTROS E KPIs
// =====================================================================

function preencherOpcoesFiltros() {
    const unicos = (prop) => [...new Set(dadosProcessados.map(d => d[prop]).filter(Boolean))].sort();

    // Garante que o select de Data seja populado caso o datas.json não o tenha feito
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
    
    // Popula dinamicamente o filtro Integração a partir dos dados existentes
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
    const horas = [...new Set(dadosProcessados.map(d => d._hora))].sort((a,b) => parseInt(a) - parseInt(b));
    sHora.innerHTML = '<option value="">Todas</option>' + horas.map(v => `<option value="${v}">${v}</option>`).join('');
}

function aplicarFiltros() {
    const elTempoNC = document.getElementById('filtro-tempo-nc');
    const minHorasNC = elTempoNC ? parseInt(elTempoNC.value, 10) || 0 : 0;

    const f = {
        data: document.getElementById('filtro-data').value,
        hora: document.getElementById('filtro-hora').value,
        empresa: document.getElementById('filtro-empresa').value,
        segmento: document.getElementById('filtro-segmento').value,
        condicao: document.getElementById('filtro-condicao').value,
        veiculo: document.getElementById('filtro-veiculo').value.trim(),
        situacao: document.getElementById('filtro-situacao').value,
        linha: document.getElementById('filtro-linha').value.trim(),
        equip: document.getElementById('filtro-equipamento').value,
        status: document.getElementById('filtro-status').value,
        nc: document.getElementById('filtro-nao-conformidade').value,
        gps: document.getElementById('filtro-status-gps').value,
        int: document.getElementById('filtro-integracao').value,
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
//                      RENDERIZAÇÃO DA TABELA
// =====================================================================

function renderizarTabela() {
    const corpo = document.getElementById('corpo-tabela');
    if(!corpo) return;
    corpo.innerHTML = '';
    
    const total = dadosFiltrados.length;
    const paginas = Math.ceil(total / linhasPorPagina) || 1;
    if (paginaAtual > paginas) paginaAtual = paginas;
    
    const inicio = (paginaAtual - 1) * linhasPorPagina;
    const fim = Math.min(inicio + linhasPorPagina, total);
    const registros = dadosFiltrados.slice(inicio, fim);

    if (total === 0) {
        corpo.innerHTML = '<tr><td colspan="12" class="p-6 text-center text-slate-500 font-bold">Nenhum registro encontrado.</td></tr>';
        document.getElementById('txt-total-registros').textContent = "Exibindo 0 de 0 registros";
        document.getElementById('txt-pag-atual').textContent = "Pág. 1 de 1";
        return;
    }

    registros.forEach(item => {
        const resFicha = resolverEstadoFicha(item._veiculo, item._data, item._hora);
        const tr = document.createElement('tr');
        tr.className = "border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800";
        
        const badgeSit = item._situacao === "Operando" 
            ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">Operando</span>'
            : '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">Manutenção</span>';

        const corInt = item._integracao === "Integrado" ? "text-emerald-500 font-bold" : (item._integracao === "Não Aplicável" ? "text-slate-400" : "text-rose-500 font-bold");

        tr.innerHTML = `
            <td>${item._data}</td>
            <td>${item._hora}</td>
            <td class="font-bold">${item._linha}</td>
            <td class="font-mono font-bold text-indigo-600 dark:text-indigo-400">${item._veiculo}</td>
            <td>${badgeSit}</td>
            <td class="text-[11px]">${item._equipamento}</td>
            <td class="text-[11px]">${item._status}</td>
            <td class="text-[10px] truncate max-w-[150px]" title="${item._ncOriginal}">${item._ncOriginal}</td>
            <td class="text-[11px] font-bold ${item._gps === 'Válido' ? 'text-emerald-500':'text-rose-500'}">${item._gps}</td>
            <td class="text-[11px] font-mono">${item._horaVal}</td>
            <td class="text-[11px] font-bold ${corInt}">${item._integracao}</td>
            <td class="text-center">${resFicha.estado === 'Sem Ficha' ? '<input type="checkbox" class="chk-abrir-ficha" data-veiculo="'+item._veiculo+'" data-data="'+item._data+'" data-hora="'+item._hora+'">' : '<div class="flex items-center justify-center gap-2"><span class="text-[10px] font-bold text-rose-500 animate-pulse">ABERTA</span><button class="btn-fechar-ficha text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded" data-idx="'+resFicha.index+'">Fechar</button></div>'}</td>
        `;
        corpo.appendChild(tr);
    });

    document.getElementById('txt-total-registros').textContent = `Exibindo ${total > 0 ? inicio + 1 : 0} a ${fim} de ${total} registros`;
    document.getElementById('txt-pag-atual').textContent = `Pág. ${paginaAtual} de ${paginas}`;
    document.getElementById('pag-anterior').disabled = paginaAtual === 1;
    document.getElementById('pag-proximo').disabled = paginaAtual === paginas;
}

function navegarPagina(dir) {
    paginaAtual += dir;
    renderizarTabela();
}

function mudarLinhasPorPagina() {
    linhasPorPagina = parseInt(document.getElementById('input-linhas-pagina').value) || 10;
    paginaAtual = 1;
    renderizarTabela();
}

function ordenarTabelaPor(coluna) {
    const campo = {'DATA': '_data', 'HORA': '_hora', 'LINHA': '_linha', 'VEÍCULO': '_veiculo', 'SITUAÇÃO': '_situacao'}[coluna] || coluna;
    if (colunaOrdenada === campo) ordemAscendente = !ordemAscendente;
    else { colunaOrdenada = campo; ordemAscendente = true; }
    dadosFiltrados.sort((a,b) => {
        let vA = a[campo] || '', vB = b[campo] || '';
        return ordemAscendente ? String(vA).localeCompare(String(vB), undefined, {numeric: true}) : String(vB).localeCompare(String(vA), undefined, {numeric: true});
    });
    renderizarTabela();
}

function limparFiltros() {
    ['filtro-hora', 'filtro-empresa', 'filtro-segmento', 'filtro-situacao', 'filtro-condicao', 'filtro-equipamento', 'filtro-status', 'filtro-nao-conformidade', 'filtro-status-gps', 'filtro-integracao'].forEach(id => { 
        const el = document.getElementById(id);
        if(el) el.value = ""; 
    });
    const elTempo = document.getElementById('filtro-tempo-nc');
    if (elTempo) elTempo.value = "0";
    atualizarSelectSegmentos();
    aplicarFiltros();
}

// =====================================================================
//                          GRÁFICOS
// =====================================================================

function atualizarGraficos() {
    const isDark = document.body.classList.contains('dark');
    const labelColor = isDark ? '#cbd5e1' : '#334155';

    // Agrupa somando apenas registros com Não Conformidades
    const agrupar = (prop) => {
        const res = {};
        dadosFiltrados.forEach(d => {
            if (d._ncResumida !== "Normal") {
                let val = d[prop] || "N/D";
                res[val] = (res[val] || 0) + 1;
            }
        });
        return { labels: Object.keys(res), data: Object.values(res) };
    };

    // Configuração padrão de Barras Horizontais (indexAxis: 'y')
    const configBarraHorizontal = (labels, data, color) => ({
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: color,
                borderRadius: 4,
                maxBarThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    anchor: 'end',
                    align: 'end',
                    color: labelColor,
                    font: { weight: 'bold', size: 10 },
                    formatter: (val) => val > 0 ? val : ''
                }
            },
            layout: { padding: { right: 35 } },
            scales: {
                x: { display: false },
                y: {
                    ticks: { color: labelColor, font: { size: 9, weight: 'bold' } },
                    grid: { display: false }
                }
            }
        }
    });

    // 1. Gráfico Por Empresa
    const gEmp = agrupar('_empresa');
    if (charts.empresa) charts.empresa.destroy();
    charts.empresa = new Chart(document.getElementById('chart-empresa'), configBarraHorizontal(gEmp.labels, gEmp.data, '#10b981'));

    // 2. Gráfico Por Segmento
    const gSeg = agrupar('_segmento');
    if (charts.segmento) charts.segmento.destroy();
    charts.segmento = new Chart(document.getElementById('chart-segmento'), configBarraHorizontal(gSeg.labels, gSeg.data, '#6366f1'));

    // 3. Gráfico Por Veículo (Barras Horizontais com Ranking Térmico)
    const rawVei = agrupar('_veiculo');
    const veiList = Object.keys(rawVei).map(k => ({ label: k, value: rawVei[k] }));
    veiList.sort((a, b) => b.value - a.value); // Ordena do maior para o menor

    const labelsVei = veiList.map(x => x.label);
    const dataVei = veiList.map(x => x.value);

    // Geração dinâmica das cores térmicas por posição no ranking
    const totalVei = veiList.length;
    const coresVei = veiList.map((_, i) => {
        if (totalVei <= 1) return '#ef4444';
        const ratio = i / (totalVei - 1);
        if (ratio < 0.30) return '#ef4444'; // Vermelho (Mais NC)
        if (ratio < 0.60) return '#f97316'; // Laranja
        if (ratio < 0.85) return '#eab308'; // Amarelo
        return '#10b981';                   // Verde (Menos NC)
    });

    // Ajuste dinâmico da altura do container para habilitar o scroll vertical suave
    const containerScroll = document.getElementById('container-scroll-veiculo');
    if (containerScroll) {
        const alturaMinima = 160;
        const alturaPorBarra = 24;
        const alturaCalculada = Math.max(alturaMinima, totalVei * alturaPorBarra);
        containerScroll.style.height = `${alturaCalculada}px`;
    }

    if (charts.veiculo) charts.veiculo.destroy();
    charts.veiculo = new Chart(document.getElementById('chart-veiculo'), configBarraHorizontal(labelsVei, dataVei, coresVei));

    // 4. Gráfico Por Equipamento
    const gEquip = agrupar('_equipamento');
    if (charts.equipamento) charts.equipamento.destroy();
    charts.equipamento = new Chart(document.getElementById('chart-equipamento'), configBarraHorizontal(gEquip.labels, gEquip.data, '#f59e0b'));

    // 5. Gráfico Por Faixa Horária
    const gHora = agrupar('_hora');
    if (charts.faixaHoraria) charts.faixaHoraria.destroy();
    charts.faixaHoraria = new Chart(document.getElementById('chart-faixa-horaria'), {
        type: 'line',
        data: {
            labels: gHora.labels,
            datasets: [{
                data: gHora.data,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: { display: true, color: labelColor, align: 'top', font: { weight: 'bold', size: 10 } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { color: labelColor } },
                x: { ticks: { color: labelColor }, grid: { display: false } }
            }
        }
    });
}

function atualizarMiniCards() {
    const container = document.getElementById('container-mini-cards');
    if(!container) return;
    const ncs = ["Sem Transmissão", "Sem GPS Válido", "Sem AVL", "Sem Processar Ponto"];
    let html = '<span class="text-[9px] font-black mr-2 title-color">INDICADOR NC:</span>';
    ncs.forEach(nc => {
        const qtd = dadosFiltrados.filter(d => d._ncResumida === nc).length;
        html += `<div class="px-2 py-0.5 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-bold bg-white dark:bg-slate-800 title-color shadow-sm">${nc}: ${qtd}</div>`;
    });
    container.innerHTML = html;
}

// =====================================================================
//                 AÇÕES DAS FICHAS DE MANUTENÇÃO
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