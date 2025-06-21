// Replace with your Supabase project details
const SUPABASE_URL = 'https://jzjbwdeiajbugyiknftv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6amJ3ZGVpYWpidWd5aWtuZnR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk5MTExNjksImV4cCI6MjA2NTQ4NzE2OX0.AQ9GQEHpZ60bP5OyMfuic8HYCVqra2uKBU_FnGW9RZk';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Check authentication
const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));
if (!currentUser) {
    window.location.href = 'index.html';
}

// Initialize user info
document.getElementById('user-name').textContent = currentUser.name;
document.getElementById('user-avatar').textContent = currentUser.name.charAt(0).toUpperCase();

// Global variables
let groceries = [];
let activities = [];
let isOnline = navigator.onLine;
let draggedElement = null;
let currentFilter = 'all';

// DOM elements
const groceryInput = document.getElementById('grocery-input');
const addButton = document.getElementById('add-btn');
const groceriesList = document.getElementById('groceries-list');
const activityList = document.getElementById('activity-list');
const selectArrow = document.querySelector('.select-arrow');
const selectDisplay = document.querySelector('.select-display');
const selectOptions = document.querySelector('.select-options');
const options = document.querySelectorAll('.option');

// Initialize app
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    updateConnectionStatus();
    await loadInitialData();
    setupEventListeners();
    setupRealtimeSubscriptions();

    // Update connection status periodically
    setInterval(updateConnectionStatus, 5000);
}

function setupEventListeners() {
    // Form submission
    document.querySelector('form').addEventListener('submit', handleAddGrocery);

    // Grocery list actions
    groceriesList.addEventListener('click', handleGroceryActions);

    // Filter dropdown
    if (selectArrow && selectDisplay && selectOptions) {
        selectArrow.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectOptions.classList.toggle('active');
        });

        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const value = option.getAttribute('data-value');
                const text = option.textContent;

                selectDisplay.textContent = text;
                selectOptions.classList.remove('active');
                currentFilter = value;
                filterGroceries();
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.select')) {
                selectOptions.classList.remove('active');
            }
        });
    }

    // Online/offline events
    window.addEventListener('online', () => {
        isOnline = true;
        updateConnectionStatus();
        syncPendingChanges();
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        updateConnectionStatus();
    });
}

async function loadInitialData() {
    showSyncIndicator(true);

    try {
        await Promise.all([
            loadGroceries(),
            loadActivities()
        ]);
    } catch (error) {
        console.error('Error loading initial data:', error);
        showError('Falha ao carregar dados. Atualize a página.');
    }

    showSyncIndicator(false);
}

async function loadGroceries() {
    const { data, error } = await supabase
        .from('groceries')
        .select(`
            *,
            users!added_by (name)
        `)
        .order('position', { ascending: true });

    if (error) {
        throw error;
    }

    groceries = data || [];
    renderGroceries();
}

async function loadActivities() {
    const { data, error } = await supabase
        .from('activities')
        .select(`
            *,
            users!user_id (name)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        throw error;
    }

    activities = data || [];
    renderActivities();
}

function renderGroceries() {
    groceriesList.innerHTML = '';

    if (groceries.length === 0) {
        showEmptyState();
        return;
    }

    groceries.forEach(grocery => {
        const groceryElement = createGroceryElement(grocery);
        groceriesList.appendChild(groceryElement);
    });

    filterGroceries();
}

function createGroceryElement(grocery) {
    const groceryDiv = document.createElement('div');
    groceryDiv.className = 'grocery-item';
    groceryDiv.dataset.id = grocery.id;
    groceryDiv.draggable = true;

    if (grocery.completed) {
        groceryDiv.classList.add('completed');
    }

    const timeAgo = getTimeAgo(grocery.created_at);
    const isRecent = Date.now() - new Date(grocery.created_at).getTime() < 10000; // 10 seconds

    groceryDiv.innerHTML = `
        <div class="grocery-content">
            <div class="grocery-name">${escapeHtml(grocery.name)}</div>
            <div class="grocery-meta">
                <span class="user-tag">${escapeHtml(grocery.users?.name || 'Desconhecido')}</span>
                <span class="action-tag">adicionou</span>
                <span class="timestamp">${timeAgo}</span>
                ${isRecent ? '<span class="real-time-badge">AO VIVO</span>' : ''}
            </div>
        </div>
        <div class="grocery-actions">
            <button class="complete-btn">
                <i class="fas fa-check"></i>
            </button>
            <button class="trash-btn">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;

    addDragListeners(groceryDiv);
    return groceryDiv;
}

function renderActivities() {
    activityList.innerHTML = '';

    if (activities.length === 0) {
        activityList.innerHTML = '<div style="text-align: center; color: #666; padding: 1rem;">Nenhuma atividade ainda</div>';
        return;
    }

    activities.forEach(activity => {
        const activityDiv = document.createElement('div');
        activityDiv.className = 'activity-item';

        const timeAgo = getTimeAgo(activity.created_at);

        // Translate action words
        let actionText = activity.action;
        switch(activity.action) {
            case 'added': actionText = 'adicionou'; break;
            case 'completed': actionText = 'concluiu'; break;
            case 'uncompleted': actionText = 'reabriu'; break;
            case 'removed': actionText = 'removeu'; break;
        }

        activityDiv.innerHTML = `
            <div class="activity-text">
                <strong>${escapeHtml(activity.users?.name || 'Desconhecido')}</strong> ${actionText} "${escapeHtml(activity.item_name)}"
            </div>
            <div class="activity-time">${timeAgo}</div>
        `;

        activityList.appendChild(activityDiv);
    });
}

async function handleAddGrocery(e) {
    e.preventDefault();

    const name = groceryInput.value.trim();
    if (!name) return;

    setFormDisabled(true);
    showSyncIndicator(true);

    try {
        const maxPosition = groceries.length > 0 ? Math.max(...groceries.map(g => g.position || 0)) : 0;

        const { data, error } = await supabase
            .from('groceries')
            .insert([{
                name: name,
                completed: false,
                position: maxPosition + 1,
                added_by: currentUser.id
            }])
            .select(`
                *,
                users!added_by (name)
            `)
            .single();

        if (error) throw error;

        // Add to local array
        groceries.push(data);

        // Add activity
        await logActivity('added', name);

        // Re-render
        renderGroceries();

        groceryInput.value = '';

    } catch (error) {
        console.error('Error adding grocery:', error);
        showError('Falha ao adicionar item. Tente novamente.');
    }

    setFormDisabled(false);
    showSyncIndicator(false);
}

async function handleGroceryActions(e) {
    const button = e.target.closest('button');
    if (!button) return;

    const groceryDiv = button.closest('.grocery-item');
    const groceryId = groceryDiv.dataset.id;
    const grocery = groceries.find(g => g.id === groceryId);

    if (!grocery) return;

    if (button.classList.contains('trash-btn')) {
        await handleDeleteGrocery(grocery, groceryDiv);
    } else if (button.classList.contains('complete-btn')) {
        await handleToggleComplete(grocery, groceryDiv);
    }
}

async function handleDeleteGrocery(grocery, groceryDiv) {
    groceryDiv.classList.add('fall');

    try {
        const { error } = await supabase
            .from('groceries')
            .delete()
            .eq('id', grocery.id);

        if (error) throw error;

        await logActivity('removed', grocery.name);

        // Remove from local array
        groceries = groceries.filter(g => g.id !== grocery.id);

        setTimeout(() => {
            if (groceryDiv.parentNode) {
                groceryDiv.remove();
            }
            if (groceries.length === 0) {
                showEmptyState();
            }
        }, 300);

    } catch (error) {
        console.error('Error deleting grocery:', error);
        groceryDiv.classList.remove('fall');
        showError('Falha ao deletar item. Tente novamente.');
    }
}

async function handleToggleComplete(grocery, groceryDiv) {
    const newCompleted = !grocery.completed;
    groceryDiv.classList.toggle('completed', newCompleted);

    try {
        const { error } = await supabase
            .from('groceries')
            .update({
                completed: newCompleted,
                updated_at: new Date().toISOString()
            })
            .eq('id', grocery.id);

        if (error) throw error;

        grocery.completed = newCompleted;
        const action = newCompleted ? 'completed' : 'uncompleted';
        await logActivity(action, grocery.name);

    } catch (error) {
        console.error('Error updating grocery:', error);
        groceryDiv.classList.toggle('completed', !newCompleted);
        showError('Falha ao atualizar item. Tente novamente.');
    }
}

async function logActivity(action, itemName) {
    try {
        const { data, error } = await supabase
            .from('activities')
            .insert([{
                action: action,
                item_name: itemName,
                user_id: currentUser.id
            }])
            .select(`
                *,
                users!user_id (name)
            `)
            .single();

        if (error) throw error;

        // Add to local activities array
        activities.unshift(data);

        // Keep only last 20
        if (activities.length > 20) {
            activities = activities.slice(0, 20);
        }

        renderActivities();

    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

function setupRealtimeSubscriptions() {
    // Subscribe to groceries changes
    supabase
        .channel('groceries_changes')
        .on('postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'groceries'
            },
            handleGroceriesRealtimeChange
        )
        .subscribe();

    // Subscribe to activities changes
    supabase
        .channel('activities_changes')
        .on('postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'activities'
            },
            handleActivitiesRealtimeChange
        )
        .subscribe();
}

async function handleGroceriesRealtimeChange(payload) {
    console.log('Groceries change:', payload);

    if (payload.eventType === 'INSERT') {
        // Load the new grocery with user info
        const { data } = await supabase
            .from('groceries')
            .select(`
                *,
                users!added_by (name)
            `)
            .eq('id', payload.new.id)
            .single();

        if (data && !groceries.find(g => g.id === data.id)) {
            groceries.push(data);
            groceries.sort((a, b) => (a.position || 0) - (b.position || 0));
            renderGroceries();
        }
    } else if (payload.eventType === 'UPDATE') {
        const index = groceries.findIndex(g => g.id === payload.new.id);
        if (index !== -1) {
            groceries[index] = { ...groceries[index], ...payload.new };
            renderGroceries();
        }
    } else if (payload.eventType === 'DELETE') {
        groceries = groceries.filter(g => g.id !== payload.old.id);
        renderGroceries();
    }
}

async function handleActivitiesRealtimeChange(payload) {
    console.log('Activity change:', payload);

    // Load the new activity with user info
    const { data } = await supabase
        .from('activities')
        .select(`
            *,
            users!user_id (name)
        `)
        .eq('id', payload.new.id)
        .single();

    if (data && !activities.find(a => a.id === data.id)) {
        activities.unshift(data);
        if (activities.length > 20) {
            activities = activities.slice(0, 20);
        }
        renderActivities();
    }
}

// Drag and drop functions
function addDragListeners(element) {
    element.addEventListener('dragstart', dragStart);
    element.addEventListener('dragend', dragEnd);
    element.addEventListener('dragover', dragOver);
    element.addEventListener('dragenter', dragEnter);
    element.addEventListener('drop', dragDrop);
}

function dragStart(e) {
    draggedElement = this;
    this.classList.add('dragging');

    const emptyImg = new Image();
    emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    e.dataTransfer.setDragImage(emptyImg, 0, 0);

    e.dataTransfer.effectAllowed = 'move';
}

async function dragEnd(e) {
    this.classList.remove('dragging');

    const allGroceries = groceriesList.querySelectorAll('.grocery-item');
    allGroceries.forEach(grocery => {
        grocery.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    if (draggedElement) {
        await updateGroceriesOrder();
    }

    draggedElement = null;
}

function dragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }

    if (this === draggedElement) {
        return false;
    }

    e.dataTransfer.dropEffect = 'move';

    const rect = this.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const mouseY = e.clientY;

    this.classList.remove('drag-over-top', 'drag-over-bottom');

    if (mouseY < midY) {
        this.classList.add('drag-over-top');
        if (this.parentNode && draggedElement) {
            this.parentNode.insertBefore(draggedElement, this);
        }
    } else {
        this.classList.add('drag-over-bottom');
        if (this.parentNode && draggedElement) {
            this.parentNode.insertBefore(draggedElement, this.nextSibling);
        }
    }

    return false;
}

function dragEnter(e) {
    if (this === draggedElement) {
        return;
    }
    e.dataTransfer.dropEffect = 'move';
}

function dragDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    this.classList.remove('drag-over-top', 'drag-over-bottom');
    return false;
}

async function updateGroceriesOrder() {
    const groceryElements = groceriesList.querySelectorAll('.grocery-item');
    const updates = [];

    groceryElements.forEach((element, index) => {
        const id = element.dataset.id;
        const grocery = groceries.find(g => g.id === id);
        if (grocery && grocery.position !== index + 1) {
            updates.push({
                id: id,
                position: index + 1
            });
            grocery.position = index + 1;
        }
    });

    if (updates.length > 0) {
        try {
            for (const update of updates) {
                await supabase
                    .from('groceries')
                    .update({ position: update.position })
                    .eq('id', update.id);
            }
        } catch (error) {
            console.error('Error updating order:', error);
            showError('Falha ao salvar nova ordem');
        }
    }
}

function filterGroceries() {
    const groceryElements = groceriesList.querySelectorAll('.grocery-item');

    groceryElements.forEach(element => {
        const isCompleted = element.classList.contains('completed');
        let shouldShow = true;

        switch (currentFilter) {
            case 'completed':
                shouldShow = isCompleted;
                break;
            case 'uncompleted':
                shouldShow = !isCompleted;
                break;
            case 'all':
            default:
                shouldShow = true;
                break;
        }

        element.style.display = shouldShow ? 'flex' : 'none';
    });
}

function updateConnectionStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('connection-text');

    if (isOnline) {
        indicator.classList.remove('offline');
        text.textContent = 'Conectado';
        enableForm();
    } else {
        indicator.classList.add('offline');
        text.textContent = 'Desconectado';
        disableForm();
    }
}

function setFormDisabled(disabled) {
    groceryInput.disabled = disabled;
    addButton.disabled = disabled;
}

function enableForm() {
    setFormDisabled(false);
}

function disableForm() {
    setFormDisabled(true);
}

function showSyncIndicator(show) {
    const indicator = document.getElementById('sync-indicator');
    indicator.classList.toggle('show', show);
}

function showError(message) {
    const toast = document.getElementById('error-toast');
    const messageEl = document.getElementById('error-message');

    messageEl.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}

function showEmptyState() {
    groceriesList.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-shopping-cart"></i>
            <h3>Sua lista está vazia</h3>
            <p>Adicione alguns itens para começar!</p>
        </div>
    `;
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now - time) / 1000);

    if (diffInSeconds < 60) return 'agora mesmo';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}min atrás`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h atrás`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d atrás`;

    return time.toLocaleDateString('pt-BR');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function syncPendingChanges() {
    console.log('Sincronizando mudanças pendentes...');
    await loadInitialData();
}

function logout() {
    sessionStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}
